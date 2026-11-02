//! Native side of Flowstay for Windows: tray, overlay window, paste-into-active-app,
//! foreground-app detection (per-app personas), Claude Code CLI bridge and OAuth callback.
//! Speech recognition itself runs in the webview (Transformers.js) and is shared with the iPhone app.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::path::PathBuf;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::PhysicalPosition;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

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

#[cfg(desktop)]
#[tauri::command]
fn set_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

/// Puts `text` on the clipboard, sends Ctrl+V to the focused app, then (optionally) restores
/// the previous clipboard text. Returns false if the paste keystroke couldn't be sent.
#[cfg(mobile)]
#[tauri::command]
fn set_clipboard(_text: String) -> Result<(), String> {
    Err("use the clipboard plugin on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
async fn paste_text(_text: String, _restore: bool) -> Result<bool, String> {
    Ok(false)
}

#[cfg(desktop)]
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
        // release modifiers the user may still be holding from the hotkey (Alt would turn Ctrl+V into a menu action)
        let mut inputs = vec![];
        for vk in [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN] {
            if (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0 {
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

#[cfg(mobile)]
#[tauri::command]
fn show_overlay(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
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

// ---------------------------------------------------------------- persistent model cache
// Speech/LLM model files are stored as plain files in the app's data folder, so the OS never
// evicts them (browser caches on iOS get wiped, which forced re-downloads).

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn key_path(dir: &std::path::Path, key: &str) -> PathBuf {
    let name: String = key
        .trim_start_matches("https://")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    dir.join(name)
}

#[tauri::command]
async fn model_cache_get(app: AppHandle, key: String) -> Result<tauri::ipc::Response, String> {
    let path = key_path(&models_dir(&app)?, &key);
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "miss".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn model_cache_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let key = request
        .headers()
        .get("x-key")
        .and_then(|v| v.to_str().ok())
        .map(url_decode)
        .ok_or("missing x-key header")?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let path = key_path(&models_dir(&app)?, &key);
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn model_cache_clear(app: AppHandle) -> Result<(), String> {
    let d = models_dir(&app)?;
    std::fs::remove_dir_all(&d).map_err(|e| e.to_string())
}

#[tauri::command]
fn platform_kind() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "windows"
    }
}

// ---------------------------------------------------------------- app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ));
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            model_cache_get,
            model_cache_put,
            model_cache_clear,
            platform_kind
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
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
                        "toggle" => {
                            let _ = app.emit("tray-action", "toggle");
                        }
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
            }

            let minimized = std::env::args().any(|a| a == "--minimized");
            if !minimized {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the main window keeps Flowstay running in the tray (desktop)
            if cfg!(desktop) {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if window.label() == "main" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Flowstay");
}
