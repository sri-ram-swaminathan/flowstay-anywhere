import { useEffect, useState } from 'preact/hooks';
import { applyHotkeys } from '../app-services';
import * as c from '../controller';
import { ASR_MODELS } from '../engine/models';
import { Recorder } from '../engine/recorder';
import { platform } from '../platform';
import { settings, useSettings } from '../store';
import { Modal, ShortcutInput } from './widgets';

export function Onboarding() {
  const s = useSettings();
  const p = platform();
  const win = p.kind === 'windows';
  const [step, setStep] = useState(0);
  const [mic, setMic] = useState<boolean | null>(null);
  const ms = c.modelState.use();
  const status = c.status.use();
  const result = c.lastResult.use();
  const [startedTry, setStartedTry] = useState(false);
  const STEPS = 5;

  useEffect(() => { if (step === 2 && ms.asr === 'unknown') c.loadAsr().catch(() => {}); }, [step]);
  useEffect(() => { if (step === 4 && status === 'recording') setStartedTry(true); }, [status, step]);

  const finish = () => settings.set({ hasCompletedOnboarding: true });
  const next = () => setStep(step + 1);

  return (
    <Modal>
      <div class="steps">{Array.from({ length: STEPS }, (_, i) => <i key={i} class={i <= step ? 'on' : ''} />)}</div>

      {step === 0 && (
        <>
          <h2>Welcome to Flowstay</h2>
          <p class="sub">Speak, and your words appear as clean text {win ? 'wherever your cursor is' : 'ready to paste anywhere'}.</p>
          <ul class="stack" style="padding-left:18px;margin:0 0 18px">
            <li>🔒 Speech recognition runs <b>on this device</b>. Your audio never leaves it.</li>
            <li>✨ Optional personas rewrite your text (clean up, professional, concise, or your own).</li>
            <li>📖 Teach it your vocabulary: names, jargon, tools.</li>
          </ul>
          <div class="inline" style="justify-content:flex-end"><button class="btn primary" onClick={next}>Get started</button></div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>Microphone access</h2>
          <p class="sub">Flowstay needs your microphone to hear you. Nothing is recorded unless you start a dictation.</p>
          {mic === false && <div class="banner warn">Access was blocked. {win ? 'Open Windows Settings → Privacy & security → Microphone and allow desktop apps.' : 'On iPhone: Settings → Safari → Microphone → Allow, then reload.'}</div>}
          <div class="inline" style="justify-content:flex-end">
            {mic ? <span class="pill ok">✓ Allowed</span> : <button class="btn" onClick={async () => setMic(await Recorder.requestPermission())}>Allow microphone</button>}
            <button class="btn primary" disabled={!mic} onClick={next}>Continue</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Choose your speech model</h2>
          <p class="sub">Downloaded once, then works offline. You can change this any time in Settings.</p>
          <div class="stack">
            {ASR_MODELS.filter((m) => win || m.sizeMB < 200).map((m) => (
              <label class={`model-opt ${s.asrModel === m.id ? 'on' : ''}`} key={m.id}>
                <input type="radio" checked={s.asrModel === m.id} onChange={() => { settings.set({ asrModel: m.id }); c.loadAsr().catch(() => {}); }} />
                <div><b>{m.label}</b> <span class="chip">{m.sizeMB} MB</span>{m.recommendedFor?.includes(win ? 'desktop' : 'phone') && <span class="pill blue" style="margin-left:6px">Recommended</span>}<div class="hint">{m.note}</div></div>
              </label>
            ))}
          </div>
          <div style="margin:14px 0">
            {ms.asr === 'loading' && <><div class="progress"><div style={{ width: `${ms.progress * 100}%` }} /></div><div class="hint">Downloading… {Math.round(ms.progress * 100)}%</div></>}
            {ms.asr === 'ready' && <span class="pill ok">✓ Ready on {ms.device === 'webgpu' ? 'GPU' : 'CPU'}</span>}
            {ms.asr === 'error' && <div class="banner warn">{ms.error} <button class="btn" onClick={() => c.loadAsr().catch(() => {})}>Retry</button></div>}
          </div>
          <div class="inline" style="justify-content:flex-end"><button class="btn primary" disabled={ms.asr !== 'ready'} onClick={next}>{ms.asr === 'ready' ? 'Continue' : 'Downloading…'}</button></div>
        </>
      )}

      {step === 3 && (
        win ? (
          <>
            <h2>Your shortcuts</h2>
            <p class="sub">Flowstay lives in the system tray. Use these anywhere in Windows:</p>
            <div class="stack">
              <div class="row"><div class="label">Toggle transcription<small>Press to start, press again to stop.</small></div><ShortcutInput value={s.toggleShortcut} onChange={(v) => { settings.set({ toggleShortcut: v }); applyHotkeys(); }} /></div>
              <div class="row"><div class="label">Hold to talk<small>Hold while speaking, release to finish.</small></div><ShortcutInput value={s.holdShortcut} onChange={(v) => { settings.set({ holdShortcut: v }); applyHotkeys(); }} /></div>
            </div>
            <p class="hint">The text is pasted where your cursor is. If a shortcut doesn't respond, another app is using it: pick a different one.</p>
            <div class="inline" style="justify-content:flex-end"><button class="btn primary" onClick={next}>Continue</button></div>
          </>
        ) : (
          <>
            <h2>Use it like an app</h2>
            <p class="sub">For the best experience on iPhone:</p>
            <ol class="stack" style="padding-left:18px">
              <li>In Safari tap <b>Share</b> <span class="kbd">⬆︎</span> → <b>Add to Home Screen</b>.</li>
              <li>Open Flowstay from your Home Screen, tap the mic, speak, tap again.</li>
              <li>The text is copied: switch to any app and <b>paste</b>.</li>
            </ol>
            <p class="hint">Tip: add Flowstay to your Dock, or open it from the App Switcher, for one-tap dictation.</p>
            <div class="inline" style="justify-content:flex-end"><button class="btn primary" onClick={next}>Continue</button></div>
          </>
        )
      )}

      {step === 4 && (
        <>
          <h2>Try it</h2>
          <p class="sub">{win ? <>Press <span class="kbd">{s.toggleShortcut.replace('Control', 'Ctrl')}</span> or tap the button, say a sentence, then stop.</> : 'Tap the button, say a sentence, tap again.'}</p>
          <div class="hero" style="padding:0">
            <button class={`mic ${status === 'recording' ? 'rec' : status !== 'idle' ? 'busy' : ''}`} onClick={() => c.toggle()}>{status === 'recording' ? '■' : '🎤'}</button>
            <div class="timer">{status === 'recording' ? 'Listening…' : status === 'transcribing' ? 'Transcribing…' : ''}</div>
          </div>
          {startedTry && result && <div class="card"><div class="result-text">{result.processedText}</div><div class="hint">🎉 That's it. {win ? 'In other apps it gets pasted for you.' : 'It is already on your clipboard.'}</div></div>}
          <div class="inline" style="justify-content:space-between">
            <button class="btn ghost" onClick={finish}>Skip</button>
            <button class="btn primary" onClick={finish}>Finish</button>
          </div>
        </>
      )}
    </Modal>
  );
}
