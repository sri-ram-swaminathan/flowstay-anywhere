import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { Recorder } from '../engine/recorder';
import { settings, useSettings, type PttKey } from '../store';
import { KEY_LABEL } from './Home';
import { Icon } from './icons';
import { Modal } from './widgets';

export function Onboarding() {
  const s = useSettings();
  const [step, setStep] = useState(0);
  const [mic, setMic] = useState<boolean | null>(null);
  const models = c.models.use();
  const ms = c.modelState.use();
  const status = c.status.use();
  const result = c.lastResult.use();
  const live = c.liveText.use();
  const [startResult] = useState(() => c.lastResult.get());
  const [dlErr, setDlErr] = useState<string | null>(null);
  const finish = () => settings.set({ hasCompletedOnboarding: true });
  const next = () => setStep(step + 1);
  const chosen = models.find((m) => m.id === s.model);

  useEffect(() => { c.refreshModels().catch(() => {}); }, []);

  const getModel = async () => {
    setDlErr(null);
    try {
      if (!chosen?.downloaded) await c.downloadModel(s.model);
      await c.loadModel();
    } catch (e: any) { setDlErr(String(e?.message ?? e)); }
  };

  return (
    <Modal>
      <div class="steps">{[0, 1, 2, 3].map((i) => <i key={i} class={i <= step ? 'on' : ''} />)}</div>

      {step === 0 && (
        <>
          <h2>Welcome to Flowstay</h2>
          <p class="sub">Hold a key, speak, let go: your words land on the clipboard and in the app you're typing in.</p>
          <div class="stack" style="margin-bottom:20px">
            <div class="inline"><Icon name="zap" /> Parakeet speech recognition runs on this PC: fast, accurate, private.</div>
            <div class="inline"><Icon name="book" /> Teach it your vocabulary: names, jargon, tools.</div>
            <div class="inline"><Icon name="sparkles" /> Optional personas rewrite your text in a different tone.</div>
          </div>
          <div class="spread"><span /><button class="btn primary" onClick={next}>Get started</button></div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>Microphone</h2>
          <p class="sub">Flowstay only listens while you hold the key (or after you tap it).</p>
          {mic === false && <div class="banner warn">Blocked. Open Windows Settings → Privacy & security → Microphone and allow desktop apps, then try again.</div>}
          <div class="spread">
            {mic ? <span class="pill ok"><Icon name="check" size="sm" />Microphone works</span> : <button class="btn" onClick={async () => setMic(await Recorder.requestPermission())}><Icon name="mic" size="sm" />Allow microphone</button>}
            <button class="btn primary" disabled={!mic} onClick={next}>Continue</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Download the speech model</h2>
          <p class="sub">One download, then everything works offline.</p>
          <div class="card">
            {models.map((m) => (
              <div class="model" key={m.id} onClick={() => ms.state !== 'downloading' && settings.set({ model: m.id })} style="cursor:pointer">
                <span class={`radio ${s.model === m.id ? 'on' : ''}`} />
                <div><b>{m.name}</b><div class="hint">{m.blurb} {(m.size / 1e6).toFixed(0)} MB</div></div>
                {m.downloaded && <span class="pill ok">Downloaded</span>}
              </div>
            ))}
          </div>
          {ms.state === 'downloading' && <div class="stack"><div class="progress"><div style={{ width: `${ms.progress * 100}%` }} /></div><span class="hint">Downloading… {Math.round(ms.progress * 100)}%</span></div>}
          {ms.state === 'loading' && <span class="hint">Loading model…</span>}
          {dlErr && <div class="banner err">{dlErr}</div>}
          <div class="spread" style="margin-top:14px">
            <span />
            {ms.state === 'ready' && chosen?.downloaded ? (
              <button class="btn primary" onClick={next}>Continue</button>
            ) : (
              <button class="btn primary" disabled={ms.state === 'downloading' || ms.state === 'loading'} onClick={getModel}><Icon name="download" size="sm" />{chosen?.downloaded ? 'Load model' : 'Download'}</button>
            )}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2>Try it</h2>
          <p class="sub">Click into any text box, then hold your key and speak. Release to finish.</p>
          <div class="row" style="padding-top:0">
            <span class="label">Push-to-talk key</span>
            <select value={s.pttKey} onChange={(e) => {
              const k = (e.target as HTMLSelectElement).value as PttKey;
              settings.set(k === 'Space' ? { pttKey: k, instantStart: true } : { pttKey: k });
              c.configureRecorder();
              c.applyShortcuts();
            }}>
              {(Object.keys(KEY_LABEL) as PttKey[]).filter((k) => k !== 'off').map((k) => <option key={k} value={k}>{KEY_LABEL[k]}</option>)}
            </select>
          </div>
          <div style="text-align:center;padding:18px 0">
            <span class={`kbd big-key ${status === 'recording' ? 'pressed' : ''}`}>{KEY_LABEL[s.pttKey]}</span>
            <div class="hint" style="margin-top:12px">{status === 'recording' ? 'Listening… release to finish' : status === 'transcribing' ? 'Transcribing…' : 'Hold it now and say a sentence'}</div>
          </div>
          {status === 'recording' && <div class="card pad live-text" style="margin-top:0">{live || 'Start talking…'}<span class="caret" /></div>}
          {result && result !== startResult && <div class="card pad"><div class="selectable">{result.processedText}</div><div class="hint" style="margin-top:6px">That's on your clipboard now. Press Ctrl+V anywhere.</div></div>}
          <div class="spread"><button class="btn ghost" onClick={finish}>Skip</button><button class="btn primary" onClick={finish}>Done</button></div>
        </>
      )}
    </Modal>
  );
}
