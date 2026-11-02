import { useEffect, useState } from 'preact/hooks';
import * as c from '../controller';
import { LLM_MODELS } from '../engine/models';
import { platform } from '../platform';
import { openRouter, rewrite } from '../providers';
import { allPersonas, settings, uid, useSettings, type AppRule, type Persona, type ProviderId } from '../store';
import { vocabularyInstruction } from '../vocabulary';
import { toast } from './toast';
import { confirmAsk, Modal, Row, Toggle } from './widgets';

export function Personas() {
  const s = useSettings();
  const p = platform();
  const personas = allPersonas(s);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [ruleEdit, setRuleEdit] = useState<AppRule | null>(null);

  return (
    <div class="page">
      <h1>Personas</h1>
      <p class="sub">Automatically adjust your tone for different apps</p>

      <h3>AI provider</h3>
      <Provider />

      <div class="card">
        <Row label={<b>✨ Enable personas</b>} hint="Rewrite each transcript with the selected style, from professional to casual.">
          <Toggle checked={s.personasEnabled} onChange={(v) => settings.set({ personasEnabled: v })} />
        </Row>
      </div>

      <h3>Default persona</h3>
      <div class="card">
        <div class="persona-pick">
          {personas.map((x) => (
            <button key={x.id} class={s.selectedPersonaId === x.id ? 'on' : ''} onClick={() => settings.set({ selectedPersonaId: x.id })}>
              <div style="font-size:20px">{x.emoji ?? '✨'}</div>
              <b>{x.name}</b>
              <div class="hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{x.instruction}</div>
            </button>
          ))}
        </div>
      </div>

      <h3 class="inline" style="justify-content:space-between">
        Your personas
        <button class="btn" onClick={() => setEditing({ id: '', name: '', instruction: '', emoji: '📝' })}>+ New persona</button>
      </h3>
      <div class="card">
        {s.userPersonas.length === 0 && <div class="meta">Create your own, e.g. “Slack casual”, “Email to professor”, “Bullet points”.</div>}
        {s.userPersonas.map((x) => (
          <div class="list-item" key={x.id}>
            <div class="emoji">{x.emoji ?? '✨'}</div>
            <div class="grow"><b>{x.name}</b><div class="hint">{x.instruction}</div></div>
            <button class="icon-btn" title="Edit" onClick={() => setEditing(x)}>✎</button>
            <button class="icon-btn" title="Delete" style="color:var(--danger)" onClick={() => {
              if (s.confirmPersonaDelete && !confirmAsk(`Delete “${x.name}”?`)) return;
              settings.set({
                userPersonas: s.userPersonas.filter((y) => y.id !== x.id),
                selectedPersonaId: s.selectedPersonaId === x.id ? 'cleanup' : s.selectedPersonaId,
                appRules: s.appRules.filter((r) => r.personaId !== x.id),
              });
            }}>🗑</button>
          </div>
        ))}
      </div>

      <h3>App-specific personas</h3>
      <div class="card">
        {p.kind === 'windows' ? (
          <>
            <Row label="Use different personas for different apps" hint="Flowstay remembers which persona you prefer for each app (e.g. Outlook → Professional, Slack → Casual).">
              <Toggle checked={s.useSmartAppDetection} onChange={(v) => settings.set({ useSmartAppDetection: v })} />
            </Row>
            {s.useSmartAppDetection && (
              <>
                <div class="row"><button class="btn" onClick={() => setRuleEdit({ id: '', appId: '', appName: '', personaId: s.selectedPersonaId ?? 'cleanup' })}>Add app rule</button></div>
                {s.appRules.map((r) => {
                  const per = personas.find((x) => x.id === r.personaId);
                  return (
                    <div class="list-item" key={r.id}>
                      <div class="emoji">🪟</div>
                      <div class="grow"><b>{r.appName}</b><div class="hint">→ {per?.emoji} {per?.name ?? 'Missing persona'} <span class="chip">{r.appId}</span></div></div>
                      <button class="icon-btn" onClick={() => setRuleEdit(r)}>✎</button>
                      <button class="icon-btn" style="color:var(--danger)" onClick={() => {
                        if (s.confirmAppRuleDelete && !confirmAsk(`Remove rule for ${r.appName}?`)) return;
                        settings.set({ appRules: s.appRules.filter((y) => y.id !== r.id) });
                      }}>🗑</button>
                    </div>
                  );
                })}
              </>
            )}
          </>
        ) : (
          <div class="meta">On your phone the text goes to the clipboard, so per-app routing isn't possible. Pick a persona above before you dictate, or use this on your Windows laptop.</div>
        )}
      </div>

      <TryIt />

      {editing && <PersonaEditor initial={editing} onClose={() => setEditing(null)} />}
      {ruleEdit && <RuleEditor initial={ruleEdit} onClose={() => setRuleEdit(null)} />}
    </div>
  );
}

function Provider() {
  const s = useSettings();
  const p = platform();
  const ms = c.modelState.use();
  const [models, setModels] = useState<{ id: string; name: string; free: boolean }[]>([]);
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [, force] = useState(0);

  useEffect(() => {
    if (s.provider === 'openrouter') openRouter.models().then(setModels).catch(() => {});
    if (s.provider === 'claude-code') p.claudeAvailable().then(setClaudeOk);
  }, [s.provider]);

  const opts: [ProviderId, string][] = [['local', 'On-device (private)'], ['openrouter', 'OpenRouter (cloud)']];
  if (p.kind === 'windows') opts.push(['claude-code', 'Claude Code (experimental)']);

  return (
    <div class="card">
      <Row label="Text processing engine">
        <select value={s.provider} onChange={(e) => settings.set({ provider: (e.target as HTMLSelectElement).value as ProviderId })}>
          {opts.map(([v, l]) => <option value={v} key={v}>{l}</option>)}
        </select>
      </Row>

      {s.provider === 'local' && (
        <>
          <div class="hint" style="margin-top:8px">🔒 Private on-device processing: a small open model runs locally, nothing leaves your device.</div>
          <div class="stack" style="margin-top:10px">
            {LLM_MODELS.map((m) => (
              <label class={`model-opt ${s.localLlmModel === m.id ? 'on' : ''}`} key={m.id}>
                <input type="radio" name="llm" checked={s.localLlmModel === m.id} onChange={() => { settings.set({ localLlmModel: m.id }); c.modelState.set({ ...c.modelState.get(), llm: 'unknown' }); }} />
                <div><b>{m.label}</b> <span class="chip">~{m.approxMB} MB</span><div class="hint">{m.note}</div></div>
              </label>
            ))}
          </div>
          <Row label={ms.llm === 'ready' ? <span class="pill ok">✓ Model ready</span> : ms.llm === 'loading' ? <span class="pill blue">Downloading {Math.round(ms.progress * 100)}%</span> : ms.llm === 'error' ? <span class="pill err">Failed: {ms.error}</span> : <span class="pill">Downloads on first use</span>}>
            <button class="btn" disabled={ms.llm === 'loading' || ms.llm === 'ready'} onClick={() => c.loadLlm().catch(() => {})}>Download now</button>
          </Row>
          {/iPhone|iPad/.test(navigator.userAgent) && <div class="hint">On iPhone, Safari can run out of memory loading a local model on older devices. If rewrites fail, use OpenRouter.</div>}
        </>
      )}

      {s.provider === 'openrouter' && (
        <>
          {openRouter.connected() ? (
            <Row label={<span class="pill ok">✓ Connected to OpenRouter</span>}>
              <button class="btn danger" onClick={() => { openRouter.setKey(''); force((n) => n + 1); }}>Disconnect</button>
            </Row>
          ) : (
            <>
              {(p.kind === 'windows' || p.kind === 'web') && <Row label="Connect your OpenRouter account" hint="Free models available. Opens a sign-in page.">
                <button class="btn primary" disabled={connecting} onClick={async () => {
                  setConnecting(true);
                  try { await openRouter.connect(); toast('OpenRouter connected'); } catch (e: any) { toast(String(e.message ?? e)); }
                  setConnecting(false);
                  force((n) => n + 1);
                }}>{connecting ? 'Waiting for browser…' : 'Connect'}</button>
              </Row>}
              <Row label={p.kind === 'windows' || p.kind === 'web' ? '…or paste an API key' : 'Paste an OpenRouter API key'} hint={p.kind === 'android' || p.kind === 'ios' ? 'Create one (free) at openrouter.ai/keys.' : undefined}>
                <span class="inline">
                  <input type="password" placeholder="sk-or-…" value={manualKey} onInput={(e) => setManualKey((e.target as HTMLInputElement).value)} />
                  <button class="btn" disabled={!manualKey} onClick={() => { openRouter.setKey(manualKey); setManualKey(''); force((n) => n + 1); }}>Save</button>
                </span>
              </Row>
            </>
          )}
          <Row label="Model">
            <span class="inline">
              <input list="or-models" style="width:260px" value={s.openRouterModel} onChange={(e) => settings.set({ openRouterModel: (e.target as HTMLInputElement).value })} />
              <datalist id="or-models">{models.map((m) => <option value={m.id} key={m.id}>{m.free ? '🆓 ' : ''}{m.name}</option>)}</datalist>
            </span>
          </Row>
        </>
      )}

      {s.provider === 'claude-code' && (
        <>
          <Row label={claudeOk === null ? 'Checking for Claude Code…' : claudeOk ? <span class="pill ok">✓ Claude Code found</span> : <span class="pill err">Claude Code not found</span>}
            hint="Uses your locally installed `claude` CLI. Signed in with your Claude account, usage follows your Pro/Max plan; with ANTHROPIC_API_KEY it bills API credits.">
            <button class="btn" onClick={() => p.claudeAvailable().then(setClaudeOk)}>Re-check</button>
          </Row>
          <Row label="Claude model">
            <select value={s.claudeCodeModel} onChange={(e) => settings.set({ claudeCodeModel: (e.target as HTMLSelectElement).value as any })}>
              <option value="haiku">Haiku (fast)</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option>
            </select>
          </Row>
          <Row label="Mode" hint={s.claudeCodeMode === 'rewrite' ? 'Strict rewrite: tools disabled, structured output. Best effort.' : 'Assistant (experimental): may answer your request instead of just rewriting.'}>
            <select value={s.claudeCodeMode} onChange={(e) => settings.set({ claudeCodeMode: (e.target as HTMLSelectElement).value as any })}>
              <option value="rewrite">Strict rewrite</option><option value="assistant">Assistant (experimental)</option>
            </select>
          </Row>
        </>
      )}
    </div>
  );
}

function PersonaEditor({ initial, onClose }: { initial: Persona; onClose: () => void }) {
  const s = settings.get();
  const [v, setV] = useState(initial);
  const save = () => {
    if (!v.name.trim() || !v.instruction.trim()) return toast('Name and instruction are required');
    const list = v.id ? s.userPersonas.map((x) => (x.id === v.id ? v : x)) : [...s.userPersonas, { ...v, id: uid() }];
    settings.set({ userPersonas: list });
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <h2>{initial.id ? 'Edit persona' : 'New persona'}</h2>
      <div class="stack" style="margin-top:14px">
        <div class="inline">
          <input style="width:56px;text-align:center;font-size:20px" value={v.emoji} maxLength={4} onInput={(e) => setV({ ...v, emoji: (e.target as HTMLInputElement).value })} />
          <input style="flex:1" placeholder="Name" value={v.name} onInput={(e) => setV({ ...v, name: (e.target as HTMLInputElement).value })} />
        </div>
        <textarea rows={5} placeholder="Instruction, e.g. “Rewrite as a friendly Slack message. Keep it short, no greeting.”" value={v.instruction} onInput={(e) => setV({ ...v, instruction: (e.target as HTMLTextAreaElement).value })} />
        <div class="inline" style="justify-content:flex-end">
          <button class="btn ghost" onClick={() => { if (v !== initial && v.instruction !== initial.instruction && !confirmAsk('Discard changes?')) return; onClose(); }}>Cancel</button>
          <button class="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function RuleEditor({ initial, onClose }: { initial: AppRule; onClose: () => void }) {
  const s = settings.get();
  const [v, setV] = useState(initial);
  const [count, setCount] = useState(0);
  const detect = () => {
    let n = 3;
    setCount(n);
    const t = setInterval(async () => {
      n--;
      setCount(n);
      if (n === 0) {
        clearInterval(t);
        const app = await platform().frontApp();
        if (app) setV((x) => ({ ...x, ...app }));
        else toast("Couldn't detect the app");
        platform().showMain();
      }
    }, 1000);
  };
  return (
    <Modal onClose={onClose}>
      <h2>App rule</h2>
      <div class="stack" style="margin-top:14px">
        <label class="hint">Pick a recently used app</label>
        <select value={v.appId} onChange={(e) => { const a = s.knownApps.find((x) => x.appId === (e.target as HTMLSelectElement).value); if (a) setV({ ...v, ...a }); }}>
          <option value="">—</option>
          {s.knownApps.map((a) => <option key={a.appId} value={a.appId}>{a.appName} ({a.appId})</option>)}
        </select>
        <div class="inline">
          <button class="btn" disabled={count > 0} onClick={detect}>{count > 0 ? `Switch to the app… ${count}` : 'Detect app (3 s)'}</button>
          <span class="hint">or type the program name</span>
        </div>
        <div class="inline">
          <input style="flex:1" placeholder="Display name (Outlook)" value={v.appName} onInput={(e) => setV({ ...v, appName: (e.target as HTMLInputElement).value })} />
          <input style="flex:1" placeholder="Program (outlook.exe)" value={v.appId} onInput={(e) => setV({ ...v, appId: (e.target as HTMLInputElement).value })} />
        </div>
        <label class="hint">Persona</label>
        <select value={v.personaId} onChange={(e) => setV({ ...v, personaId: (e.target as HTMLSelectElement).value })}>
          {allPersonas(s).map((x) => <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>)}
        </select>
        <div class="inline" style="justify-content:flex-end">
          <button class="btn ghost" onClick={onClose}>Cancel</button>
          <button class="btn primary" disabled={!v.appId} onClick={() => {
            const name = v.appName || v.appId;
            const list = v.id ? s.appRules.map((r) => (r.id === v.id ? { ...v, appName: name } : r)) : [...s.appRules.filter((r) => r.appId.toLowerCase() !== v.appId.toLowerCase()), { ...v, appName: name, id: uid() }];
            settings.set({ appRules: list });
            onClose();
          }}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function TryIt() {
  const s = useSettings();
  const [text, setText] = useState('um so basically i think we should like move the meeting to thursday because uh the report isnt ready yet');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const persona = allPersonas(s).find((x) => x.id === s.selectedPersonaId);
  return (
    <>
      <h3>Try it</h3>
      <div class="card stack">
        <textarea rows={3} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="inline">
          <button class="btn primary" disabled={busy || !persona} onClick={async () => {
            setBusy(true);
            const r = await rewrite(c.engine, text, persona!.instruction, s.vocabEnabled ? vocabularyInstruction(s.vocabulary) : '');
            setOut(r.ok ? r.text : `⚠️ ${r.error}`);
            setBusy(false);
          }}>{busy ? 'Rewriting…' : `Rewrite with ${persona?.emoji ?? ''} ${persona?.name ?? ''}`}</button>
        </div>
        {out && <div class="original" style="color:var(--text)">{out}</div>}
      </div>
    </>
  );
}
