import { useEffect, useState } from 'preact/hooks';
import { checkForUpdate, VERSION } from '../app-services';
import * as c from '../controller';
import { PARAKEET_V3_LANGUAGES } from '../engine/models';
import { Recorder } from '../engine/recorder';
import { platform, type EngineModel } from '../platform';
import { clearLog, readLog, settings, useSettings, type PttKey } from '../store';
import { KEY_LABEL } from './Home';
import { Icon } from './icons';
import { toast } from './toast';
import { confirmAsk, download, Row, ShortcutInput, Toggle } from './widgets';

export function Settings() {
  const s = useSettings();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [shortcutErr, setShortcutErr] = useState<string | null>(null);
  const models = c.models.use();
  const current = models.find((m) => m.id === s.model);

  useEffect(() => { Recorder.listInputs().then(setMics).catch(() => {}); c.refreshModels().catch(() => {}); }, []);

  const setShortcuts = async (patch: Partial<typeof s>) => {
    settings.set(patch);
    setShortcutErr(await c.applyShortcuts());
  };
  const setMic = (patch: Partial<typeof s>) => { settings.set(patch); c.configureRecorder(); };

  return (
    <div class="page">
      <h1>Settings</h1>
      <p class="sub">Flowstay {VERSION} · everything runs on this PC</p>

      <h3>Speech model</h3>
      <div class="card">
        {models.map((m) => <ModelRow key={m.id} m={m} active={s.model === m.id} />)}
        {current?.multilingual && (
          <Row label="Language" hint="Auto-detect works well; pick one if you always speak the same language.">
            <select value={s.language} onChange={(e) => settings.set({ language: (e.target as HTMLSelectElement).value })}>
              {PARAKEET_V3_LANGUAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Row>
        )}
      </div>

      <h3>Shortcuts</h3>
      <div class="card">
        <Row label="Push-to-talk key" hint={s.pttKey === 'Space'
          ? 'Hold Space to talk, like Claude Code: a quick tap still types a space, and Space works normally with Ctrl/Alt/Win held or in admin windows. Instant start is turned on so your first word isn\'t clipped.'
          : 'Hold to talk and release to finish, or tap once to start and again to stop. Right Ctrl doesn\'t type anything, so it\'s safe on every keyboard layout.'}>
          <select value={s.pttKey} onChange={(e) => {
            const k = (e.target as HTMLSelectElement).value as PttKey;
            if (k === 'Space' && !s.instantStart) setMic({ instantStart: true });
            setShortcuts({ pttKey: k });
          }}>
            {(Object.keys(KEY_LABEL) as PttKey[]).map((k) => <option key={k} value={k}>{k === 'off' ? 'Off' : KEY_LABEL[k]}</option>)}
          </select>
        </Row>
        <Row label="Shortcut" hint="Hold to talk, or tap to start and tap again to stop. Note: while Flowstay runs it takes this combination from other apps (Ctrl+Space is also autocomplete in VS Code and an input-method switch for some languages).">
          <span class="inline">
            <ShortcutInput value={s.toggleShortcut} onChange={(v) => setShortcuts({ toggleShortcut: v })} />
            {s.toggleShortcut && <button class="icon-btn" title="Remove" onClick={() => setShortcuts({ toggleShortcut: '' })}><Icon name="x" size="sm" /></button>}
          </span>
        </Row>
        <Row label="Cancel" hint="While recording, Esc throws the recording away."><span class="kbd">Esc</span></Row>
        {shortcutErr && <div class="banner warn" style="margin:0 0 12px">{shortcutErr}</div>}
      </div>

      <h3>Output</h3>
      <div class="card">
        <Row label="Copy to clipboard" hint="Always on: your words are on the clipboard the moment you stop."><span class="pill ok"><Icon name="check" size="sm" />Always</span></Row>
        <Row label="Also paste into the app you're typing in" hint="Sends Ctrl+V to the window that was active when you started. The text stays on the clipboard either way.">
          <Toggle checked={s.autoPasteEnabled} onChange={(v) => settings.set({ autoPasteEnabled: v })} />
        </Row>
        <Row label="Live preview" hint="See your words appear as you speak, in the recording bubble and here.">
          <Toggle checked={s.livePreview} onChange={(v) => settings.set({ livePreview: v })} />
        </Row>
        <Row label="Remove filler words" hint="Drops um / uh / er and stutters like “I I think”. Instant, no AI.">
          <Toggle checked={s.cleanupEnabled} onChange={(v) => settings.set({ cleanupEnabled: v })} />
        </Row>
        <Row label="Sound cues"><Toggle checked={s.soundFeedbackEnabled} onChange={(v) => settings.set({ soundFeedbackEnabled: v })} /></Row>
        <Row label="Recording bubble" hint="A small pill at the bottom of the screen while you dictate."><Toggle checked={s.showOverlay} onChange={(v) => settings.set({ showOverlay: v })} /></Row>
      </div>

      <h3>Microphone</h3>
      <div class="card">
        <Row label="Input device">
          <select value={s.micDeviceId} onChange={(e) => setMic({ micDeviceId: (e.target as HTMLSelectElement).value })}>
            <option value="">System default</option>
            {mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </Row>
        <Row label="Instant start" hint="Keeps the microphone open so recording starts with zero delay and your first word is never clipped. Windows will show the mic as in use.">
          <Toggle checked={s.instantStart} onChange={(v) => setMic({ instantStart: v })} />
        </Row>
        <Row label="Stop after silence" hint="Ends a tapped (hands-free) recording when you stop talking.">
          <select value={s.silenceTimeoutSeconds} onChange={(e) => setMic({ silenceTimeoutSeconds: +(e.target as HTMLSelectElement).value })}>
            {[[5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [0, 'Never']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
      </div>

      <h3>System</h3>
      <div class="card">
        <Row label="Face" hint="Silver (brushed aluminium) or black (matte), like the two faces decks shipped in. System follows Windows light/dark mode.">
          <select value={s.face} onChange={(e) => settings.set({ face: (e.target as HTMLSelectElement).value as any })}>
            <option value="system">System</option><option value="silver">Silver</option><option value="black">Black</option>
          </select>
        </Row>
        <AutostartRow />
        <Row label="Check for updates"><Toggle checked={s.checkForUpdates} onChange={(v) => settings.set({ checkForUpdates: v })} /></Row>
        <Row label={`Version ${VERSION}`}><button class="btn" onClick={async () => toast((await checkForUpdate(true)) ?? '')}>Check now</button></Row>
      </div>

      <Troubleshooting />
    </div>
  );
}

function ModelRow({ m, active }: { m: EngineModel; active: boolean }) {
  const ms = c.modelState.use();
  const [dl, setDl] = useState(false);
  const speed = Math.max(1, Math.min(5, Math.round(Math.log2(m.cpuSpeed) - 0.8)));
  const acc = Math.max(1, Math.min(5, Math.round(9 - m.englishWer)));
  const use = async () => {
    settings.set({ model: m.id });
    if (m.downloaded) c.loadModel();
  };
  return (
    <div class="model">
      <span class={`radio ${active ? 'on' : ''}`} onClick={use} />
      <div onClick={use} style="cursor:pointer">
        <div class="inline"><b>{m.name}</b>{active && ms.state === 'ready' && <span class="pill ok">In use</span>}</div>
        <div class="hint">{m.blurb} {(m.size / 1e6).toFixed(0)} MB.</div>
        <div class="inline hint" style="gap:14px;margin-top:4px">
          <span>Accuracy <Bars n={acc} /></span>
          <span>Speed <Bars n={speed} /> {m.cpuSpeed.toFixed(0)}× real time</span>
        </div>
        {dl && ms.state === 'downloading' && <div class="progress" style="margin-top:8px"><div style={{ width: `${ms.progress * 100}%` }} /></div>}
      </div>
      <div class="inline">
        {m.downloaded ? (
          <button class="icon-btn danger" title="Delete download" onClick={async () => {
            if (!confirmAsk(`Delete ${m.name}?`)) return;
            await platform().deleteModel(m.id);
            await c.refreshModels();
            if (active) c.modelState.set({ state: 'none', progress: 0 });
          }}><Icon name="trash" size="sm" /></button>
        ) : (
          <button class="btn" disabled={ms.state === 'downloading'} onClick={async () => {
            setDl(true);
            try {
              await c.downloadModel(m.id);
              settings.set({ model: m.id });
              await c.loadModel();
              toast(`${m.name} is ready`);
            } catch (e: any) { toast(String(e?.message ?? e)); }
            setDl(false);
          }}><Icon name="download" size="sm" />{dl ? `${Math.round(ms.progress * 100)}%` : 'Download'}</button>
        )}
      </div>
    </div>
  );
}

const Bars = ({ n }: { n: number }) => <span class="bars">{[1, 2, 3, 4, 5].map((i) => <b key={i} class={i <= n ? 'on' : ''} />)}</span>;

function AutostartRow() {
  const s = useSettings();
  const p = platform();
  useEffect(() => { p.getAutostart().then((on) => on !== s.launchAtLogin && settings.set({ launchAtLogin: on })).catch(() => {}); }, []);
  return (
    <Row label="Start with Windows" hint="Runs quietly in the tray so your shortcut always works.">
      <Toggle checked={s.launchAtLogin} onChange={async (v) => {
        try { await p.setAutostart(v); settings.set({ launchAtLogin: v }); } catch (e) { toast(`Couldn't change: ${e}`); }
      }} />
    </Row>
  );
}

function Troubleshooting() {
  const s = useSettings();
  const [logs, setLogs] = useState<string[] | null>(null);
  return (
    <>
      <h3>Troubleshooting</h3>
      <div class="card">
        <Row label="Microphone permission" hint="If nothing records: Windows Settings → Privacy & security → Microphone → allow desktop apps.">
          <button class="btn" onClick={async () => toast((await Recorder.requestPermission()) ? 'Microphone works' : 'Microphone blocked')}>Test</button>
        </Row>
        <Row label="Reload speech model"><button class="btn" onClick={() => c.loadModel().then((ok) => toast(ok ? 'Model reloaded' : 'Reload failed'))}>Reload</button></Row>
        <Row label="Diagnostics log">
          <span class="inline">
            <button class="btn" onClick={() => setLogs(logs ? null : readLog())}>{logs ? 'Hide' : 'Show'}</button>
            <button class="btn" onClick={() => download(new Blob([readLog().join('\n') + `\n\nSettings: ${JSON.stringify({ ...s, vocabulary: s.vocabulary.length, userPersonas: s.userPersonas.length })}`], { type: 'text/plain' }), 'flowstay-diagnostics.txt')}>Export</button>
            <button class="btn ghost" onClick={() => { clearLog(); setLogs([]); }}>Clear</button>
          </span>
        </Row>
        {logs && <div class="log">{logs.length ? logs.slice().reverse().join('\n') : 'Empty'}</div>}
        <Row label="Show setup again"><button class="btn" onClick={() => settings.set({ hasCompletedOnboarding: false })}>Start</button></Row>
        <Row label="Reset all settings" hint="Keeps your history and downloaded models."><button class="btn danger" onClick={() => confirmAsk('Reset all settings, personas and vocabulary?') && settings.reset()}>Reset</button></Row>
      </div>
    </>
  );
}
