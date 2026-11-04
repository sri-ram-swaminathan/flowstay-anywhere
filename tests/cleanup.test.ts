import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTranscript } from '../src/cleanup.ts';

test('removes fillers and stutters', () => {
  assert.equal(cleanTranscript('um so I I think we should, uh, move the meeting.'), 'So I think we should, move the meeting.');
  assert.equal(cleanTranscript('Uh, hello there.'), 'Hello there.');
  assert.equal(cleanTranscript('the the report is ready'), 'The report is ready');
});

test('keeps real words and fixes spacing', () => {
  assert.equal(cleanTranscript('I like umbrellas , really .'), 'I like umbrellas, really.');
  assert.equal(cleanTranscript('hello.world is here'), 'Hello. World is here');
  assert.equal(cleanTranscript('She had had a long day'), 'She had had a long day');
  assert.equal(cleanTranscript('it is is is broken'), 'It is broken');
});
