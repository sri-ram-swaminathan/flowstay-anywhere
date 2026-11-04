// Custom vocabulary: make words you use often come out right.
//
// Works in three layers:
//  1. The speech engine is biased toward your terms while it decodes (capped at 40:
//     long lists make models invent vocabulary on quiet audio).
//  2. Every transcript is corrected locally:
//     - "hear → write" rules (aliases): whole-word, case-insensitive, longest first, and
//       tolerant of glued/hyphenated forms ("CloudCode", "cloud-code" → Claude Code);
//     - case fixes ("github" → "GitHub");
//     - fuzzy/phonetic matches of 1–4 word spans ("pie torch" → "PyTorch").
//  3. Persona rewrites are told the exact spellings to keep.

export interface VocabEntry {
  id: string;
  term: string;
  /** Optional spoken forms / common mis-hearings that should become `term`. */
  soundsLike: string[];
  enabled: boolean;
}

export interface VocabOptions {
  /** 0..1, higher = only near-identical matches are replaced. */
  strictness: number;
}

export interface Correction {
  from: string;
  to: string;
  kind: 'alias' | 'case' | 'fuzzy';
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** A compact Metaphone-style phonetic key (English-centric but language-agnostic enough). */
export function phonetic(word: string): string {
  let w = norm(word);
  if (!w) return '';
  w = w
    .replace(/^kn|^gn|^pn|^wr/, (m) => m[1])
    .replace(/^x/, 's')
    .replace(/^wh/, 'w')
    .replace(/mb$/, 'm')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/sch/g, 'sk')
    .replace(/tch/g, 'ch')
    .replace(/th/g, '0')
    .replace(/sh|sio|tio/g, 'x')
    .replace(/ch/g, 'x')
    .replace(/c(?=[iey])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/dg(?=[iey])/g, 'j')
    .replace(/d/g, 't')
    .replace(/gh(?![aeiou])/g, '')
    .replace(/g(?=[iey])/g, 'j')
    .replace(/x/g, 'x')
    .replace(/z/g, 's')
    .replace(/v/g, 'f')
    .replace(/b/g, 'p')
    .replace(/[0-9]/g, (d) => d);
  const first = w[0];
  let rest = w.slice(1).replace(/[aeiouyhw]/g, '');
  const key = (/[aeiou]/.test(first) ? 'a' : first) + rest;
  return key.replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const sim = (a: string, b: string) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

/** Very common words we never fuzzily overwrite on their own. */
const STOP = new Set(
  'a an the and or but if of to in on at by for with from as is are was were be been it its this that these those i you he she we they me my your our their not no yes do did done have has had will would can could should so just like um uh okay ok hi hey there here what when where why how who which all any some more most very really also get got go going make made know think see say said one two three four five six seven eight nine ten'.split(
    ' ',
  ),
);

interface Token { text: string; start: number; end: number }

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;
  for (let m; (m = re.exec(text)); ) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

interface Candidate { start: number; end: number; tokStart: number; tokEnd: number; to: string; score: number; kind: Correction['kind'] }

export function applyVocabulary(text: string, entries: VocabEntry[], opts: VocabOptions = { strictness: 0.5 }): { text: string; corrections: Correction[] } {
  const active = entries.filter((e) => e.enabled && e.term.trim());
  if (!active.length || !text.trim()) return { text, corrections: [] };
  const toks = tokenize(text);
  const cands: Candidate[] = [];
  // thresholds scale with strictness
  const strThr = 0.72 + 0.2 * opts.strictness; // spelling similarity
  const phoThr = 0.6 + 0.25 * opts.strictness; // used together with phonetic similarity
  const exactPhoThr = 0.35 + 0.3 * opts.strictness; // identical phonetic key

  for (const e of active) {
    const term = e.term.trim();
    const termN = norm(term);
    if (!termN) continue;
    const termP = tokenize(term).map((t) => phonetic(t.text)).join('');
    const termWords = Math.max(1, tokenize(term).length);
    const aliases = e.soundsLike.map((s) => s.trim()).filter(Boolean);
    const aliasN = aliases.map(norm);
    const maxSpan = Math.min(4, Math.max(termWords + 2, ...aliases.map((a) => tokenize(a).length)));

    for (let i = 0; i < toks.length; i++) {
      for (let n = 1; n <= maxSpan && i + n <= toks.length; n++) {
        const span = toks.slice(i, i + n);
        const raw = text.slice(span[0].start, span[n - 1].end);
        const spanN = span.map((t) => norm(t.text)).join('');
        if (!spanN) continue;
        // never let a span swallow sentence punctuation between words
        if (n > 1 && /[.!?;:]/.test(text.slice(span[0].end, span[n - 1].start))) break;
        const push = (score: number, kind: Correction['kind']) =>
          cands.push({ start: span[0].start, end: span[n - 1].end, tokStart: i, tokEnd: i + n, to: term, score, kind });

        if (aliasN.includes(spanN)) { push(3 + n * 0.01, 'alias'); continue; }
        if (spanN === termN) { if (raw !== term) push(2 + n * 0.01, 'case'); continue; }

        // fuzzy: skip trivially short or very common single words
        if (termN.length < 4) continue;
        if (n === 1 && STOP.has(spanN)) continue;
        if (span.every((t) => STOP.has(norm(t.text)))) continue;
        const lenRatio = spanN.length / termN.length;
        if (lenRatio < 0.6 || lenRatio > 1.6) continue;
        const s = sim(spanN, termN);
        const spanP = span.map((t) => phonetic(t.text)).join('');
        const pExact = spanP === termP && termP.length >= 4;
        const pSame = pExact || sim(spanP, termP) >= 0.85;
        if (s >= strThr || (pSame && s >= phoThr) || (pExact && s >= exactPhoThr)) push(s + (pSame ? 0.2 : 0), 'fuzzy');
      }
    }
  }

  // choose non-overlapping best candidates (prefer higher score, then longer span)
  cands.sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start));
  const taken: Candidate[] = [];
  const used = new Array(toks.length).fill(false);
  for (const c of cands) {
    let free = true;
    for (let k = c.tokStart; k < c.tokEnd; k++) if (used[k]) { free = false; break; }
    if (!free) continue;
    for (let k = c.tokStart; k < c.tokEnd; k++) used[k] = true;
    taken.push(c);
  }
  taken.sort((a, b) => b.start - a.start);
  let out = text;
  const corrections: Correction[] = [];
  for (const c of taken) {
    const from = out.slice(c.start, c.end);
    // keep possessive "'s" if the span ended with it and the term doesn't
    let to = c.to;
    if (/['’]s$/i.test(from) && !/['’]s$/i.test(to)) to += from.slice(-2);
    if (from === to) continue;
    out = out.slice(0, c.start) + to + out.slice(c.end);
    corrections.push({ from, to, kind: c.kind });
  }
  return { text: out, corrections: corrections.reverse() };
}

/** Terms handed to the speech engine for biasing. */
export const BIAS_LIMIT = 40;
export function vocabularyTerms(entries: VocabEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const t = e.term.trim();
    if (!e.enabled || !t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === BIAS_LIMIT) break;
  }
  return out;
}

/** Warn about "sounds like" rules that would fire on ordinary speech. Never blocks. */
const COMMON = new Set('a about all also and any are as at back be because but by call can case check class close cloud code come could data day did do does down each even file find first for from get give go good great group had has have he her here him his how if in into is it its just key know like line list look make man many may me more most my need new no not now number of off on one only open or other our out over page part people point put read right run said same say see set she should show side so some state still such take team test than that the their them then there these they thing think this time to two type up us use user very want was way we well were what when where which who will with word work would year you your'.split(' '));
export function aliasWarning(alias: string, term: string): string | null {
  const a = alias.trim();
  if (!a) return null;
  const words = a.split(/[\s-]+/).filter(Boolean);
  if (words.length === 1 && COMMON.has(a.toLowerCase())) return `“${a}” is an everyday word: every use of it will become “${term}”.`;
  if (words.length === 1 && a.length <= 3) return `“${a}” is very short and may match more than you mean.`;
  return null;
}

/** Instruction appended to persona rewrites so the LLM keeps your spellings. */
export function vocabularyInstruction(entries: VocabEntry[]): string {
  const terms = entries.filter((e) => e.enabled && e.term.trim()).map((e) => e.term.trim());
  return terms.length
    ? `\nThe speaker uses these terms; always spell them exactly like this when they occur (and fix near-miss spellings of them): ${terms.join(', ')}.`
    : '';
}

export function parseVocabImport(text: string): Omit<VocabEntry, 'id'>[] {
  // one per line: "Term" or "Term: alias one, alias two" (also accepts "Term = alias")
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [term, rest = ''] = l.split(/\s*[:=]\s*/, 2);
      return { term: term.trim(), soundsLike: rest.split(',').map((s) => s.trim()).filter(Boolean), enabled: true };
    })
    .filter((e) => e.term);
}
