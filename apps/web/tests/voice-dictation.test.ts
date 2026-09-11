import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { appendDictation, idleDictation, recognitionConstructor, VoiceDictation, type DictationState, type Recognition } from '../lib/voice-dictation.ts';

class FakeRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: Recognition['onstart'] = null;
  onend: Recognition['onend'] = null;
  onerror: Recognition['onerror'] = null;
  onresult: Recognition['onresult'] = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  start() { this.starts++; }
  stop() { this.stops++; }
  abort() { this.aborts++; }
  results(...words: string[]) { this.onresult?.({ results: words.map((transcript) => [{ transcript }]) }); }
}

function setup(t: TestContext) {
  const engines: FakeRecognition[] = [];
  class Engine extends FakeRecognition { constructor() { super(); engines.push(this); } }
  let text = '';
  let state: DictationState = idleDictation;
  const history: DictationState[] = [];
  const controller = new VoiceDictation(Engine, (next) => { text = next; }, (next) => { state = next; history.push(next); });
  t.after(() => controller.dispose());
  return { controller, engines, history, get text() { return text; }, get state() { return state; } };
}

test('detects standard/prefixed APIs only in secure environments', () => {
  assert.equal(recognitionConstructor({ isSecureContext: true, SpeechRecognition: FakeRecognition }), FakeRecognition);
  assert.equal(recognitionConstructor({ isSecureContext: true, webkitSpeechRecognition: FakeRecognition }), FakeRecognition);
  assert.equal(recognitionConstructor({ isSecureContext: false, SpeechRecognition: FakeRecognition }), undefined);
  assert.equal(recognitionConstructor({ isSecureContext: true }), undefined);
});

test('replaces interim hypotheses, handles shortened lists, and never duplicates final segments', (t) => {
  const s = setup(t);
  s.controller.start('Already typed.\n', 5000, 'en-GB');
  const engine = s.engines[0]!;
  assert.equal(s.state.phase, 'starting');
  assert.equal(engine.lang, 'en-GB');
  assert.equal(engine.continuous && engine.interimResults, true);
  engine.onstart?.();
  engine.results('Visit Rome', 'then par');
  assert.equal(s.text, 'Already typed.\nVisit Rome then par');
  engine.results('Visit Rome', 'then Paris');
  assert.equal(s.text, 'Already typed.\nVisit Rome then Paris');
  engine.results('Visit Rome');
  assert.equal(s.text, 'Already typed.\nVisit Rome');
  engine.results('Visit Rome', 'then Paris');
  engine.results('Visit Rome', 'then Paris');
  assert.equal(s.text, 'Already typed.\nVisit Rome then Paris');
  s.controller.stop();
  assert.equal(s.state.phase, 'stopping');
  engine.results('Visit Rome', 'then Paris.');
  engine.onend?.();
  assert.equal(s.state.phase, 'idle');
  assert.equal(s.text, 'Already typed.\nVisit Rome then Paris.');
});

test('editing freezes visible text and ignores queued results across repeated sessions', (t) => {
  const s = setup(t);
  s.controller.start('Trip:', 5000, 'en-US');
  const first = s.engines[0]!;
  first.onstart?.();
  first.results('Paris');
  const lateResult = first.onresult!;
  const lateEnd = first.onend!;
  s.controller.cancel();
  assert.equal(first.aborts, 1);
  const edited = 'Trip: Lyon (edited)';
  s.controller.start(edited, 5000, 'en-US');
  s.controller.start('must not start twice', 5000, 'en-US');
  assert.equal(s.engines.length, 2);
  const second = s.engines[1]!;
  second.onstart?.();
  second.results('and Rome');
  lateResult({ results: [[{ transcript: 'lost edit' }]] });
  lateEnd();
  assert.equal(s.text, 'Trip: Lyon (edited) and Rome');
  assert.equal(s.state.phase, 'listening');
});

test('permission, capture, network, silence, and service failures preserve text and allow retry', (t) => {
  const s = setup(t);
  for (const error of ['not-allowed', 'audio-capture', 'network', 'no-speech', 'service-not-allowed', 'language-not-supported', 'unknown']) {
    s.controller.start('Keep me', 5000, 'en-GB');
    const engine = s.engines.at(-1)!;
    engine.results('and these words');
    engine.onerror?.({ error });
    assert.equal(s.text, 'Keep me and these words');
    assert.equal(s.state.phase, 'idle');
    assert.ok(s.state.message);
    assert.equal(engine.aborts, 1);
    assert.equal(engine.onresult, null);
  }
});

test('start/stop timeouts and cancelling before permission cannot leave listening stuck', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t);
  s.controller.start('', 5000, 'en-GB');
  t.mock.timers.tick(15000);
  assert.equal(s.state.phase, 'idle');
  assert.match(s.state.message, /did not start/);
  s.controller.start('', 5000, 'en-GB');
  s.controller.stop();
  assert.equal(s.engines[1]!.aborts, 1);
  s.controller.start('', 5000, 'en-GB');
  s.engines[2]!.onstart?.();
  s.engines[2]!.results('Retain interim');
  s.controller.stop();
  t.mock.timers.tick(2000);
  assert.equal(s.state.phase, 'idle');
  assert.equal(s.text, 'Retain interim');
  assert.equal(s.engines[2]!.aborts, 1);
});

test('unmount disposes handlers, timers and queued events without more callbacks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t);
  s.controller.start('Typed', 5000, 'en-GB');
  const engine = s.engines[0]!;
  const result = engine.onresult!;
  const start = engine.onstart!;
  const before = s.history.length;
  s.controller.dispose();
  result({ results: [[{ transcript: 'late' }]] });
  start();
  t.mock.timers.tick(20000);
  s.controller.start('', 5000, 'en-GB');
  assert.equal(s.history.length, before);
  assert.equal(engine.aborts, 1);
  assert.equal(engine.onresult, null);
  assert.equal(s.text, '');
});

test('respects composer limits, existing whitespace, and Unicode boundaries', (t) => {
  assert.equal(appendDictation('Typed', ' words ', 20), 'Typed words');
  assert.equal(appendDictation('Typed\n', 'words', 20), 'Typed\nwords');
  assert.equal(appendDictation('', '😀', 1), '');
  const s = setup(t);
  s.controller.start('1234', 6, 'en-GB');
  s.engines[0]!.results('56789');
  assert.equal(s.text, '1234 5');
  assert.equal(s.state.phase, 'idle');
  assert.match(s.state.message, /limit/);
  s.controller.start('123456', 6, 'en-GB');
  assert.equal(s.engines.length, 1);
});

test('constructor/start exceptions recover without discarding input', () => {
  for (const failConstructor of [true, false]) {
    class Broken extends FakeRecognition {
      constructor() { super(); if (failConstructor) throw new Error('unavailable'); }
      start() { throw new DOMException('denied', 'NotAllowedError'); }
    }
    let state = idleDictation;
    const controller = new VoiceDictation(Broken, () => assert.fail('Must not replace text'), (next) => { state = next; });
    controller.start('Keep', 5000, 'en-GB');
    assert.equal(state.phase, 'idle');
    assert.ok(state.message);
    controller.dispose();
  }
});
