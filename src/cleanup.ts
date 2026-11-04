// Deterministic transcript cleanup (no AI): filler words, stutters, spacing, capitalisation.
// Same idea as Handy's filler removal and Murmur's rule-based formatter.

const FILLERS = ['um', 'umm', 'uh', 'uhh', 'uh-huh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm'];
const FILLER_RE = new RegExp(`(^|[\\s,])(?:${FILLERS.map((f) => f.replace('-', '\\-')).join('|')})(?=[\\s,.!?]|$)[,]?`, 'gi');

export function cleanTranscript(text: string): string {
  let t = ` ${text.trim()} `;
  t = t.replace(FILLER_RE, '$1');
  // stutters: any word said 3+ times in a row, or a doubled word that is never grammatical
  // ("I I", "the the"). Doubles like "had had" or "that that" are real English and stay.
  t = t.replace(/\b([\p{L}']+)(?:[\s,]+\1\b){2,}/giu, '$1');
  t = t.replace(/\b(i|a|an|the|and|we|you|they|my|of|in|on|so|but)(?:[\s,]+\1\b)/giu, '$1');
  t = t
    .replace(/\s+([,.!?;:])/g, '$1') // no space before punctuation
    .replace(/([,.!?;:])(?=[\p{L}])/gu, '$1 ') // space after punctuation
    .replace(/,\s*([.!?])/g, '$1') // ", ." → "."
    .replace(/^[\s,]+/, '') // leading commas left by removed fillers
    .replace(/\s{2,}/g, ' ')
    .trim();
  // capitalise sentence starts
  t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a, c) => a + c.toUpperCase());
  return t;
}
