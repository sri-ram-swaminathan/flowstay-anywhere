// End-to-end check run in CI (needs internet for model downloads):
// plays a real speech clip into the app as a fake microphone and verifies each model's transcript,
// the vocabulary feature, and (optionally) the on-device persona rewrite.
//   node tests/e2e.mjs <url> <jfk.wav>
import { chromium } from 'playwright';

const [url = 'http://localhost:4173/', wav = 'jfk.wav'] = process.argv.slice(2);
const ASR = (process.env.E2E_ASR || 'moonshine-base,moonshine-v2-small,whisper-base').split(',');
const LLM = (process.env.E2E_LLM || 'gemma-3-270m,qwen3.5-0.8b').split(',').filter(Boolean);
const results = [];
let failed = false;

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});

async function page(settings) {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1100, height: 800 } });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text().slice(0, 300)));
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await p.goto(url);
  await p.evaluate((s) => localStorage.setItem('flowstay.settings.v1', JSON.stringify(s)), { hasCompletedOnboarding: true, autoCopyEnabled: false, silenceTimeoutSeconds: 0, ...settings });
  await p.reload();
  return p;
}

for (const model of ASR) {
  const t0 = Date.now();
  const vocab = [{ id: 'v1', term: 'Flowstay Country', soundsLike: ['your country'], enabled: true }];
  const p = await page({ asrModel: model, vocabulary: vocab, vocabEnabled: true });
  try {
    await p.waitForSelector('text=· CPU', { timeout: 300_000 }); // model loaded
    const loadS = (Date.now() - t0) / 1000;
    await p.click('.mic');
    await p.waitForTimeout(12_000); // jfk.wav is ~11 s
    await p.click('.mic');
    await p.waitForSelector('.result-text', { timeout: 180_000 });
    const text = await p.locator('.result-text').first().innerText();
    const ok = /ask not what/i.test(text) && /Flowstay Country/.test(text);
    results.push({ model, ok, loadS, text });
    if (!ok) failed = true;
  } catch (e) {
    failed = true;
    results.push({ model, ok: false, error: String(e).slice(0, 300) });
  }
  await p.context().close();
}

for (const llm of LLM) {
  const p = await page({ provider: 'local', localLlmModel: llm, personasEnabled: true, selectedPersonaId: 'cleanup' });
  try {
    await p.click('nav >> text=Personas');
    await p.click('text=Rewrite with');
    await p.waitForSelector('.original', { timeout: 600_000 });
    const out = await p.locator('.original').last().innerText();
    const ok = !out.startsWith('⚠️') && /thursday/i.test(out);
    results.push({ llm, ok, text: out });
    if (!ok) failed = true;
  } catch (e) {
    failed = true;
    results.push({ llm, ok: false, error: String(e).slice(0, 300) });
  }
  await p.context().close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
const md = ['| model | ok | detail |', '|---|---|---|', ...results.map((r) => `| ${r.model ?? r.llm} | ${r.ok ? '✅' : '❌'} | ${(r.text ?? r.error ?? '').replace(/\|/g, '/').slice(0, 160)}${r.loadS ? ` (load ${r.loadS.toFixed(0)} s)` : ''} |`)];
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
process.exit(failed ? 1 : 0);
