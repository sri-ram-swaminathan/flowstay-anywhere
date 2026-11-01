import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVocabulary, parseVocabImport, type VocabEntry } from '../src/vocabulary.ts';

let n = 0;
const v = (term: string, soundsLike: string[] = []): VocabEntry => ({ id: String(n++), term, soundsLike, enabled: true });
const VOCAB = [
  v('PyTorch'), v('Kubernetes'), v('GitHub'), v('Maastricht'), v('CBS', ['c b s', 'see bee ess']),
  v('Moonshine'), v('Sri Ram'), v('uv', ['you vee']), v('MLflow'), v('LangGraph'),
];
const fix = (s: string, strictness = 0.5) => applyVocabulary(s, VOCAB, { strictness }).text;

test('case fixes', () => {
  assert.equal(fix('push it to github today'), 'push it to GitHub today');
  assert.equal(fix('we log runs in mlflow.'), 'we log runs in MLflow.');
});

test('split / misheard words', () => {
  assert.equal(fix('I trained it in pie torch yesterday'), 'I trained it in PyTorch yesterday');
  assert.equal(fix('deploy on cooper netties'), 'deploy on Kubernetes');
  assert.equal(fix('my internship at c b s is fun'), 'my internship at CBS is fun');
  assert.equal(fix('install it with you vee'), 'install it with uv');
  assert.equal(fix('I study in maastrict.'), 'I study in Maastricht.');
  assert.equal(fix('built with lang graph'), 'built with LangGraph');
});

test('leaves normal text alone', () => {
  const s = 'Can you get the report to me by Friday? I think the torch is lit.';
  assert.equal(fix(s), s);
  assert.equal(fix('the moon is shining tonight'), 'the moon is shining tonight');
  assert.equal(fix('We will see.'), 'We will see.');
});

test('possessive and punctuation preserved', () => {
  assert.equal(fix("github's API is down, and pytorch is fine!"), "GitHub's API is down, and PyTorch is fine!");
});

test('disabled entries ignored', () => {
  const r = applyVocabulary('push to github', [{ ...v('GitHub'), enabled: false }], { strictness: 0.5 });
  assert.equal(r.text, 'push to github');
});

test('import format', () => {
  assert.deepEqual(parseVocabImport('# c\nPyTorch\nCBS: c b s, see bee ess\n'), [
    { term: 'PyTorch', soundsLike: [], enabled: true },
    { term: 'CBS', soundsLike: ['c b s', 'see bee ess'], enabled: true },
  ]);
});
