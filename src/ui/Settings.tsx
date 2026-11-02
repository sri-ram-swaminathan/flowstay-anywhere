import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { ASR_MODELS, findAsr, WHISPER_LANGUAGES } from '../engine/models';
import { Recorder } from '../engine/recorder';
import { platform } from '../platform';
import { clearLog, log, readLog, settings, useSettings } from '../store';
import { applyHotkeys, checkForUpdate, VERSION } from '../app-services';
import { toast } from './toast';
import { confirmAsk, download, Row, ShortcutInput, Toggle } from './widgets';

export function Settings() {
  const s = useSettings();
  const p = platform();
  const win = p.kind === 'windows';
  const ms = c.modelState.use();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [hotkeyErr, setHotkeyErr] = useState<string | null>(null);

  useEffect(() => { Recorder.listInputs().then(setMics).catch(() => {}); }, []);

  const changeModel = (patch: Partial<typeof s>) => {
    settings.set(patch);
    c.modelState.set({ ...c.modelState.get(), asr: 'unknown' });
    c.loadAsr().catch(() => {});
  };
  const setHotkeys = async (patch: Partial<typeof s>) => {
    settings.set(patch);
    setHotkeyErr(await applyHotkeys());
  };
  const model = findAsr(s.asrModel);

  return (
    <div class="page">
      <h1>Settings</h1>
      <p class="sub">Flowstay Anywhere {VERSION} · {win ? 'Windows' : p.isStandalone ? 'Home Screen app' : 'Web app'}</p>

      <h3>Speech model (on-device)</h3>
      <div class="card stack">
        {ASR_MODELS.map((m) => (
          <label class={`model-opt ${s.asrModel === m.id ? 'on' : ''}`} key={m.id}>
            <input type="radio" name="asr" checked={s.asrModel === m.id} onChange={() => changeModel({ asrModel: m.id })} />
            <div>
              <b>{m.label}</b> <span class="chip">{m.sizeMB} MB</span> <span class="chip">{m.languages === 'en' ? 'English' : 'Multilingual'}</span>
              {m.recommendedFor?.map((r) => <span class="pill blue" style="margin-left:4px" key={r}>Best for {r === 'phone' ? 'iPhone' : 'laptop'}</span>)}
              <div class="hint">{m.note}</div>
            </div>
          </label>
        ))}
        <Row label="Status">
          <span class={`pill ${ms.asr === 'ready' ? 'ok' : ms.asr === 'error' ? 'err' : 'blue'}`}>
            {ms.asr === 'ready' ? `Ready on ${ms.device === 'webgpu' ? 'GPU (WebGPU)' : 'CPU (WASM)'}` : ms.asr === 'loading' ? `Downloading ${Math.round(ms.progress * 100)}%` : ms.asr === 'error' ? ms.error : 'Not loaded'}
          </span>
        </Row>
        {ms.asr === 'loading' && <div class="progress"><div style={{ width: `${ms.progress * 100}%` }} /></div>}
        <Row label="Acceleration" hint="Auto uses the GPU for Whisper and the CPU for Moonshine (fastest for small models).">
          <select value={s.asrDevice} onChange={(e) => changeModel({ asrDevice: (e.target as HTMLSelectElement).value as any })}>
            <option value="auto">Auto</option><option value="gpu">GPU (WebGPU)</option><option value="cpu">CPU</option>
          </select>
        </Row>
        {model.languages === 'multi' && (
          <Row label="Spoken language">
            <select value={s.language} onChange={(e) => settings.set({ language: (e.target as HTMLSelectElement).value })}>
              {WHISPER_LANGUAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Row>
        )}
      </div>

      <h3>Recording</h3>
      <div class="card">
        <Row label="Microphone">
          <select value={s.micDeviceId} onChange={(e) => settings.set({ micDeviceId: (e.target as HTMLSelectElement).value })}>
            <option value="">System default</option>
            {mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </Row>
        <Row label="Auto-stop after silence" hint="Stops recording when you've been quiet this long.">
          <select value={s.silenceTimeoutSeconds} onChange={(e) => settings.set({ silenceTimeoutSeconds: +(e.target as HTMLSelectElement).value })}>
            {[[5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [0, 'Never']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
        <Row label="Sound feedback"><Toggle checked={s.soundFeedbackEnabled} onChange={(v) => settings.set({ soundFeedbackEnabled: v })} /></Row>
      </div>

      <h3>Output</h3>
      <div class="card">
        {win && <Row label="Paste into the active app" hint="Types the result where your cursor is (simulates Ctrl+V)."><Toggle checked={s.autoPasteEnabled} onChange={(v) => settings.set({ autoPasteEnabled: v })} /></Row>}
        {win && s.autoPasteEnabled && <Row label="Keep transcript on clipboard after pasting" hint="Off: your previous clipboard is put back after the paste."><Toggle checked={s.keepOnClipboard} onChange={(v) => settings.set({ keepOnClipboard: v })} /></Row>}
        <Row label="Copy result to clipboard" hint={win ? 'Always on when you dictate from inside Flowstay.' : 'Paste it into any app afterwards. iOS sometimes blocks this; the copy button always works.'}>
          <Toggle checked={s.autoCopyEnabled} onChange={(v) => settings.set({ autoCopyEnabled: v })} />
        </Row>
        {win && <Row label="Show recording overlay" hint="A small bubble at the bottom of the screen while you dictate."><Toggle checked={s.showOverlay} onChange={(v) => settings.set({ showOverlay: v })} /></Row>}
      </div>

      {win && (
        <>
          <h3>Keyboard shortcuts</h3>
          <div class="card">
            <Row label="Hotkey behaviour" hint={{ toggle: 'Press once to start, again to stop.', hold: 'Hold the hold-to-talk shortcut while speaking.', both: 'Toggle shortcut toggles; hold-to-talk shortcut is push-to-talk.' }[s.hotkeyPressMode]}>
              <select value={s.hotkeyPressMode} onChange={(e) => setHotkeys({ hotkeyPressMode: (e.target as HTMLSelectElement).value as any })}>
                <option value="toggle">Toggle</option><option value="hold">Hold</option><option value="both">Both</option>
              </select>
            </Row>
            {s.hotkeyPressMode !== 'hold' && <Row label="Toggle transcription"><ShortcutInput value={s.toggleShortcut} onChange={(v) => setHotkeys({ toggleShortcut: v })} /></Row>}
            {s.hotkeyPressMode !== 'toggle' && <Row label="Hold to talk" hint="Windows has no Fn-key access, so hold-to-talk uses its own shortcut."><ShortcutInput value={s.holdShortcut} onChange={(v) => setHotkeys({ holdShortcut: v })} /></Row>}
            {hotkeyErr && <div class="banner warn" style="margin-top:10px">{hotkeyErr}</div>}
          </div>
          <h3>System</h3>
          <div class="card">
            <AutostartRow />
          </div>
        </>
      )}

      <Troubleshooting />
    </div>
  );
}

function AutostartRow() {
  const s = useSettings();
  const p = platform();
  useEffect(() => { p.getAutostart().then((on) => on !== s.launchAtLogin && settings.set({ launchAtLogin: on })).catch(() => {}); }, []);
  return (
    <Row label="Launch at login">
      <Toggle checked={s.launchAtLogin} onChange={async (v) => {
        try { await p.setAutostart(v); settings.set({ launchAtLogin: v }); } catch (e) { toast(`Couldn't change: ${e}`); }
      }} />
    </Row>
  );
}

function Troubleshooting() {
  const s = useSettings();
  const [mic, setMic] = useState<string>('unknown');
  const [logs, setLogs] = useState<string[] | null>(null);
  const [update, setUpdate] = useState<string | null>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);

  useEffect(() => {
    (navigator.permissions as any)?.query({ name: 'microphone' }).then((r: PermissionStatus) => { setMic(r.state); r.onchange = () => setMic(r.state); }).catch(() => {});
    (navigator as any).gpu?.requestAdapter().then((a: any) => setGpu(!!a)).catch(() => setGpu(false)) ?? setGpu(false);
  }, []);

  const clearModels = async () => {
    if (!confirmAsk('Delete downloaded models? They will download again next time.')) return;
    for (const k of await caches.keys()) if (k.includes('transformers')) await caches.delete(k);
    c.modelState.set({ asr: 'unknown', llm: 'unknown', progress: 0 });
    toast('Model cache cleared');
    log('Model cache cleared');
  };

  return (
    <>
      <h3>Permissions &amp; troubleshooting</h3>
      <div class="card">
        <Row label="Microphone" hint={mic === 'denied' ? (platform().kind === 'web' ? 'Blocked. iPhone: Settings → Safari → Microphone → Allow, then reopen.' : 'Blocked. Windows: Settings → Privacy & security → Microphone → allow desktop apps.') : undefined}>
          <span class="inline">
            <span class={`pill ${mic === 'granted' ? 'ok' : mic === 'denied' ? 'err' : 'warn'}`}>{mic === 'granted' ? 'Allowed' : mic === 'denied' ? 'Blocked' : 'Not asked yet'}</span>
            {mic !== 'granted' && <button class="btn" onClick={async () => { const ok = await Recorder.requestPermission(); setMic(ok ? 'granted' : 'denied'); }}>Request</button>}
          </span>
        </Row>
        <Row label="GPU acceleration (WebGPU)"><span class={`pill ${gpu ? 'ok' : ''}`}>{gpu === null ? '…' : gpu ? 'Available' : 'Not available (CPU used)'}</span></Row>
        <Row label="Reload speech model" hint="Fixes most 'model failed' errors."><button class="btn" onClick={() => c.loadAsr().then(() => toast('Model reloaded')).catch((e) => toast(String(e)))}>Reload</button></Row>
        <Row label="Delete downloaded models"><button class="btn" onClick={clearModels}>Clear cache</button></Row>
        <Row label="Diagnostics log">
          <span class="inline">
            <button class="btn" onClick={() => setLogs(logs ? null : readLog())}>{logs ? 'Hide' : 'Show'}</button>
            <button class="btn" onClick={() => download(new Blob([readLog().join('\n') + `\n\nUA: ${navigator.userAgent}\nSettings: ${JSON.stringify({ ...s, vocabulary: s.vocabulary.length, userPersonas: s.userPersonas.length })}`], { type: 'text/plain' }), 'flowstay-diagnostics.txt')}>Export</button>
            <button class="btn ghost" onClick={() => { clearLog(); setLogs([]); }}>Clear</button>
          </span>
        </Row>
        {logs && <div class="log">{logs.length ? logs.slice().reverse().join('\n') : 'Empty'}</div>}
        <Row label="Show onboarding again"><button class="btn" onClick={() => settings.set({ hasCompletedOnboarding: false })}>Start</button></Row>
        <Row label="Reset all settings" hint="Keeps history and downloaded models."><button class="btn danger" onClick={() => confirmAsk('Reset all settings, personas and vocabulary?') && settings.reset()}>Reset</button></Row>
      </div>

      <h3>Updates</h3>
      <div class="card">
        <Row label={`Version ${VERSION}`} hint={platform().kind === 'web' ? 'The iPhone app updates itself when you reopen it.' : undefined}>
          {platform().kind === 'windows' && <button class="btn" onClick={async () => setUpdate(await checkForUpdate(true))}>Check now</button>}
        </Row>
        {platform().kind === 'windows' && <Row label="Check for updates automatically"><Toggle checked={s.checkForUpdates} onChange={(v) => settings.set({ checkForUpdates: v })} /></Row>}
        {update && <div class="banner" style="margin-top:10px">{update}</div>}
      </div>
    </>
  );
}
