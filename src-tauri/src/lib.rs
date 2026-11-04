//! Native side of Flowstay for Windows: tray, overlay window, paste-into-active-app,
//! foreground-app detection (per-app personas), Claude Code CLI bridge and OAuth callback.
//! Speech recognition itself runs in the webview (Transformers.js) and is shared with the iPhone app.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontApp {
    app_id: String,
    app_name: String,
}

#[derive(Serialize)]
struct CmdOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Serialize, Clone)]
struct OAuthCallback {
    code: String,
    state: String,
}

// ---------------------------------------------------------------- clipboard / paste

#[tauri::command]
fn set_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

/// Puts `text` on the clipboard, sends Ctrl+V to the focused app, then (optionally) restores
/// the previous clipboard text. Returns false if the paste keystroke couldn't be sent.
#[tauri::command]
async fn paste_text(text: String, restore: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let previous = if restore { cb.get_text().ok() } else { None };
        cb.set_text(text.clone()).map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(60));
        let sent = send_ctrl_v();
        if let Some(prev) = previous {
            // give the target app time to read the clipboard before restoring
            std::thread::sleep(Duration::from_millis(450));
            if cb.get_text().ok().as_deref() == Some(text.as_str()) {
                let _ = cb.set_text(prev);
            }
        }
        Ok(sent)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn send_ctrl_v() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    unsafe {
        // Wait (up to 600 ms) for the user to let go of hotkey modifiers: a held Alt/Shift/Win
        // would turn Ctrl+V into a different shortcut. Faking key-ups instead can leave apps
        // thinking a modifier is stuck.
        let held = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0;
        let mods = [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN, VK_CONTROL];
        let t = std::time::Instant::now();
        while mods.iter().any(|&m| held(m)) && t.elapsed().as_millis() < 600 {
            std::thread::sleep(Duration::from_millis(10));
        }
        let mut inputs = vec![];
        for vk in [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN] {
            if held(vk) {
                inputs.push(key(vk, true));
            }
        }
        inputs.extend([key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)]);
        let n = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        n as usize == inputs.len()
    }
}

#[cfg(not(windows))]
fn send_ctrl_v() -> bool {
    false
}

// ---------------------------------------------------------------- foreground app

#[tauri::command]
fn foreground_app() -> Option<FrontApp> {
    foreground_exe().and_then(|path| {
        let file = std::path::Path::new(&path).file_name()?.to_string_lossy().to_string();
        let own = std::env::current_exe().ok()?.file_name()?.to_string_lossy().to_string();
        if file.eq_ignore_ascii_case(&own) {
            return None;
        }
        let stem = file.trim_end_matches(".exe").trim_end_matches(".EXE");
        let app_name = pretty_name(stem);
        Some(FrontApp { app_id: file.to_lowercase(), app_name })
    })
}

fn pretty_name(stem: &str) -> String {
    let known = [
        ("outlook", "Outlook"), ("olk", "Outlook (new)"), ("winword", "Word"), ("excel", "Excel"),
        ("powerpnt", "PowerPoint"), ("onenote", "OneNote"), ("ms-teams", "Teams"), ("teams", "Teams"),
        ("slack", "Slack"), ("discord", "Discord"), ("chrome", "Chrome"), ("msedge", "Edge"),
        ("firefox", "Firefox"), ("code", "VS Code"), ("notepad", "Notepad"), ("obsidian", "Obsidian"),
        ("notion", "Notion"), ("whatsapp", "WhatsApp"), ("telegram", "Telegram"), ("windowsterminal", "Terminal"),
    ];
    let lower = stem.to_lowercase();
    for (k, v) in known {
        if lower == k {
            return v.to_string();
        }
    }
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

#[cfg(windows)]
fn foreground_exe() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(not(windows))]
fn foreground_exe() -> Option<String> {
    None
}

// ---------------------------------------------------------------- Claude Code CLI

fn find_claude() -> Option<std::path::PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &["exe", "cmd", "bat"] } else { &[""] };
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = std::path::PathBuf::from(home);
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(std::path::PathBuf::from(appdata).join("npm"));
    }
    for d in dirs {
        for e in exts {
            let p = if e.is_empty() { d.join("claude") } else { d.join(format!("claude.{e}")) };
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[tauri::command]
fn claude_available() -> bool {
    find_claude().is_some()
}

#[tauri::command]
async fn run_claude(args: Vec<String>, stdin: String, timeout_ms: u64) -> Result<CmdOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe = find_claude().ok_or("Claude Code (claude) not found on PATH")?;
        let is_script = exe.extension().map(|e| e != "exe").unwrap_or(false);
        let mut cmd = if is_script {
            // npm installs a .cmd shim, which must run through cmd.exe (no newlines allowed in args there)
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&exe);
            c.args(args.iter().map(|a| a.replace(['\r', '\n'], " ")));
            c
        } else {
            let mut c = Command::new(&exe);
            c.args(&args);
            c
        };
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start Claude Code: {e}"))?;
        if let Some(mut si) = child.stdin.take() {
            let _ = si.write_all(stdin.as_bytes());
        }
        let mut out = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let t_out = std::thread::spawn(move || { let mut s = String::new(); let _ = out.read_to_string(&mut s); s });
        let t_err = std::thread::spawn(move || { let mut s = String::new(); let _ = err.read_to_string(&mut s); s });
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let status = loop {
            if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
                break st;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                return Err("Claude Code timed out".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        Ok(CmdOutput {
            code: status.code().unwrap_or(-1),
            stdout: t_out.join().unwrap_or_default(),
            stderr: t_err.join().unwrap_or_default(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- OpenRouter OAuth (loopback)

#[tauri::command]
fn oauth_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, addr)) => {
                    if !addr.ip().is_loopback() {
                        continue;
                    }
                    let _ = stream.set_nonblocking(false);
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.split_whitespace().nth(1).unwrap_or("");
                    if !path.starts_with("/callback") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                        continue;
                    }
                    let query = path.split_once('?').map(|x| x.1).unwrap_or("");
                    let get = |k: &str| {
                        query.split('&').find_map(|kv| {
                            let (a, b) = kv.split_once('=')?;
                            (a == k).then(|| url_decode(b))
                        })
                    };
                    let body = "<html><body style=\"font-family:system-ui;text-align:center;padding:60px\"><h2>Flowstay is connected to OpenRouter</h2><p>You can close this tab.</p></body></html>";
                    let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes());
                    if let Some(code) = get("code") {
                        let _ = app.emit("oauth-callback", OAuthCallback { code, state: get("state").unwrap_or_default() });
                        show_main_window(&app);
                    }
                    return;
                }
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        }
    });
    Ok(port)
}

fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------- windows

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn show_main(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("overlay").ok_or("no overlay window")?;
    // bottom-centre of the monitor the cursor is on (falls back to primary)
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let (Some(m), Ok(size)) = (monitor, w.outer_size()) {
        let mp = m.position();
        let ms = m.size();
        let margin = (90.0 * m.scale_factor()) as i32;
        let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
        let y = mp.y + ms.height as i32 - size.height as i32 - margin;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.set_ignore_cursor_events(true);
    w.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
}

// ---------------------------------------------------------------- speech engine (native)

struct EngineState {
    engine: flowstay_engine::Engine,
    dir: std::path::PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelEntry {
    id: &'static str,
    name: &'static str,
    blurb: &'static str,
    size: u64,
    english_wer: f32,
    cpu_speed: f32,
    multilingual: bool,
    downloaded: bool,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    id: String,
    loaded: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedModel {
    id: String,
    vocabulary: bool,
    load_ms: u64,
}

#[derive(Serialize)]
struct TranscribeOutput {
    text: String,
    ms: u64,
}

#[tauri::command]
fn engine_models(state: tauri::State<'_, EngineState>) -> Vec<ModelEntry> {
    flowstay_engine::MODELS
        .iter()
        .map(|m| ModelEntry {
            id: m.id,
            name: m.name,
            blurb: m.blurb,
            size: m.size,
            english_wer: m.english_wer,
            cpu_speed: m.cpu_speed,
            multilingual: m.multilingual,
            downloaded: flowstay_engine::is_downloaded(&state.dir, m),
        })
        .collect()
}

#[tauri::command]
async fn engine_download(app: AppHandle, state: tauri::State<'_, EngineState>, id: String) -> Result<(), String> {
    let m = flowstay_engine::find(&id).ok_or("unknown model")?;
    let dir = state.dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        flowstay_engine::download(&dir, m, |loaded, total| {
            let _ = app.emit("model-progress", DownloadProgress { id: id.clone(), loaded, total });
        })
        .map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn engine_delete(state: tauri::State<'_, EngineState>, id: String) -> Result<(), String> {
    let m = flowstay_engine::find(&id).ok_or("unknown model")?;
    state.engine.unload();
    std::fs::remove_file(flowstay_engine::model_path(&state.dir, m)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn engine_load(state: tauri::State<'_, EngineState>, id: String) -> Result<LoadedModel, String> {
    let m = flowstay_engine::find(&id).ok_or("unknown model")?;
    if !flowstay_engine::is_downloaded(&state.dir, m) {
        return Err("not-downloaded".into());
    }
    let engine = state.engine.clone();
    let path = flowstay_engine::model_path(&state.dir, m);
    tauri::async_runtime::spawn_blocking(move || engine.load(path, &id))
        .await
        .map_err(|e| e.to_string())?
        .map(|l| LoadedModel { id: l.id, vocabulary: l.vocabulary, load_ms: l.load_ms as u64 })
}

/// Body: raw little-endian f32 PCM, 16 kHz mono. Options travel in headers.
#[tauri::command]
async fn engine_transcribe(state: tauri::State<'_, EngineState>, request: tauri::ipc::Request<'_>) -> Result<TranscribeOutput, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PCM".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(url_decode);
    let vocabulary: Vec<String> = header("x-vocabulary").and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let language = header("x-language").filter(|l| !l.is_empty() && l != "auto");
    let pcm: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = flowstay_engine::trim_silence(&pcm);
        if trimmed.len() < 4000 {
            return Ok(flowstay_engine::Output { text: String::new(), ms: 0 });
        }
        engine.transcribe(trimmed.to_vec(), vocabulary, language)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|o| TranscribeOutput { text: o.text, ms: o.ms as u64 })
}

// ---------------------------------------------------------------- push-to-talk key
// A low-level keyboard hook sees single keys like Right Ctrl, which normal global shortcuts
// can't. The key is observed, never swallowed (so it can't get "stuck" in other apps).

#[cfg(windows)]
mod ptt {
    //! Push-to-talk key via a low-level keyboard hook.
    //!
    //! Ordinary keys (Right Ctrl, Caps Lock, …) are observed, never swallowed.
    //!
    //! Space works like Claude Code's voice mode: hold it past a short threshold to dictate,
    //! tap it to type a normal space. To make that possible Space is held back until we know
    //! which it was: a tap is replayed as a space; if another key goes down first (fast
    //! typing), the space is replayed *before* that key so the text stays in order. Space is
    //! left alone entirely with modifiers held or when an elevated (admin) window has focus,
    //! because Windows doesn't let us replay keys into those.
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    const VK_SPACE_CODE: u32 = 0x20;
    pub const HOLD_MS: u64 = 300;
    // space state machine
    const IDLE: u8 = 0;
    const PENDING: u8 = 1; // pressed, not yet decided
    const ACTIVE: u8 = 2; // held past threshold: dictating
    const PASSTHRU: u8 = 3; // pressed with modifiers / elevated window: behave normally

    static KEY: AtomicU32 = AtomicU32::new(0);
    static DOWN: AtomicBool = AtomicBool::new(false);
    static SPACE: AtomicU8 = AtomicU8::new(IDLE);
    static TOKEN: AtomicU32 = AtomicU32::new(0);
    static TX: OnceLock<Mutex<mpsc::Sender<&'static str>>> = OnceLock::new();

    pub fn set_key(vk: u32) {
        KEY.store(vk, Ordering::SeqCst);
        DOWN.store(false, Ordering::SeqCst);
        SPACE.store(IDLE, Ordering::SeqCst);
    }

    fn send(e: &'static str) {
        if let Some(tx) = TX.get() {
            if let Ok(tx) = tx.lock() {
                let _ = tx.send(e);
            }
        }
    }

    fn key_input(vk: u16, scan: u16, up: bool, extended: bool) -> INPUT {
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }

    unsafe fn replay_space(then: Option<&KBDLLHOOKSTRUCT>) {
        let scan = MapVirtualKeyW(VK_SPACE_CODE, MAPVK_VK_TO_VSC) as u16;
        let mut inputs = vec![key_input(VK_SPACE_CODE as u16, scan, false, false), key_input(VK_SPACE_CODE as u16, scan, true, false)];
        if let Some(k) = then {
            inputs.push(key_input(k.vkCode as u16, k.scanCode as u16, false, k.flags.0 & LLKHF_EXTENDED.0 != 0));
        }
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }

    unsafe fn modifiers_held() -> bool {
        [VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].iter().any(|vk| (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0)
    }

    unsafe fn foreground_is_elevated() -> bool {
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return false;
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return true; // can't even query it: treat as protected
        };
        let mut token = HANDLE::default();
        let mut elevated = false;
        if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok() {
            let mut info = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            if GetTokenInformation(token, TokenElevation, Some(&mut info as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok() {
                elevated = info.TokenIsElevated != 0;
            }
            let _ = CloseHandle(token);
        }
        let _ = CloseHandle(process);
        elevated
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code != HC_ACTION as i32 {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let key = KEY.load(Ordering::Relaxed);
        let msg = wparam.0 as u32;
        let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        if injected || key == 0 {
            return CallNextHookEx(None, code, wparam, lparam);
        }

        if key == VK_SPACE_CODE {
            let st = SPACE.load(Ordering::SeqCst);
            if kb.vkCode == VK_SPACE_CODE {
                if is_down {
                    match st {
                        IDLE => {
                            if modifiers_held() || foreground_is_elevated() {
                                SPACE.store(PASSTHRU, Ordering::SeqCst);
                                return CallNextHookEx(None, code, wparam, lparam);
                            }
                            SPACE.store(PENDING, Ordering::SeqCst);
                            let token = TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_millis(HOLD_MS));
                                if TOKEN.load(Ordering::SeqCst) == token
                                    && SPACE.compare_exchange(PENDING, ACTIVE, Ordering::SeqCst, Ordering::SeqCst).is_ok()
                                {
                                    send("down");
                                }
                            });
                            return LRESULT(1);
                        }
                        PASSTHRU => return CallNextHookEx(None, code, wparam, lparam),
                        _ => return LRESULT(1), // auto-repeat while held
                    }
                } else {
                    SPACE.store(IDLE, Ordering::SeqCst);
                    TOKEN.fetch_add(1, Ordering::SeqCst);
                    match st {
                        PENDING => {
                            replay_space(None); // it was a tap: type the space
                            return LRESULT(1);
                        }
                        ACTIVE => {
                            send("up");
                            return LRESULT(1);
                        }
                        _ => return CallNextHookEx(None, code, wparam, lparam),
                    }
                }
            } else if is_down && st == PENDING {
                // typing fast: space then this key. Replay both, in order.
                SPACE.store(PASSTHRU, Ordering::SeqCst);
                TOKEN.fetch_add(1, Ordering::SeqCst);
                replay_space(Some(kb));
                return LRESULT(1);
            }
            return CallNextHookEx(None, code, wparam, lparam);
        }

        // ordinary push-to-talk keys: observe only
        let event = if kb.vkCode == key {
            if is_down != DOWN.swap(is_down, Ordering::SeqCst) {
                Some(if is_down { "down" } else { "up" })
            } else {
                None
            }
        } else if is_down && DOWN.load(Ordering::Relaxed) {
            Some("combo") // the key was used as a modifier (e.g. Ctrl+C)
        } else {
            None
        };
        if let Some(e) = event {
            send(e);
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn start(app: AppHandle) {
        let (tx, rx) = mpsc::channel::<&'static str>();
        let _ = TX.set(Mutex::new(tx));
        std::thread::spawn(move || {
            while let Ok(e) = rx.recv() {
                let _ = app.emit("ptt", e);
            }
        });
        std::thread::spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok();
            let _hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(|m| m.into()), 0);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        });
    }
}

#[tauri::command]
fn ptt_set_key(vk: u32) {
    #[cfg(windows)]
    ptt::set_key(vk);
    #[cfg(not(windows))]
    let _ = vk;
}

// ---------------------------------------------------------------- app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_clipboard,
            paste_text,
            foreground_app,
            claude_available,
            run_claude,
            oauth_listen,
            show_main,
            show_overlay,
            hide_overlay,
            engine_models,
            engine_download,
            engine_delete,
            engine_load,
            engine_transcribe,
            ptt_set_key
        ])
        .setup(|app| {
            if let Err(e) = flowstay_engine::init() {
                eprintln!("speech engine init failed: {e}");
            }
            let dir = app.path().app_data_dir()?.join("models");
            app.manage(EngineState { engine: flowstay_engine::Engine::start(), dir });
            #[cfg(windows)]
            ptt::start(app.handle().clone());
            let toggle = MenuItem::with_id(app, "toggle", "Start / stop transcription", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Flowstay", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Flowstay", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("tray")
                .icon(icon)
                .tooltip("Flowstay")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "toggle" => { let _ = app.emit("tray-action", "toggle"); }
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let minimized = std::env::args().any(|a| a == "--minimized");
            if !minimized {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the main window keeps Flowstay running in the tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Flowstay");
}
