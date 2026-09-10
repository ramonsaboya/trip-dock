import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LiveRecognition } from '../lib/live-recognition.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(t: TestContext, options: { microphone?: () => Promise<MediaStream>; request?: typeof fetch } = {}) {
  const track = { enabled: true, onended: null as (() => void) | null, stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const sent: string[] = [];
  const channel = {
    readyState: 'open', onopen: null as (() => void) | null, onclose: null as (() => void) | null,
    onerror: null as (() => void) | null, onmessage: null as ((event: { data: string }) => void) | null,
    close() {}, send(value: string) { sent.push(value); },
  };
  let peerClosed = false;
  let remoteSet = false;
  const pc = {
    connectionState: 'connected', onconnectionstatechange: null as (() => void) | null,
    addTrack() {}, createDataChannel: () => channel,
    async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; },
    async setLocalDescription() {}, async setRemoteDescription() { remoteSet = true; },
    close() { peerClosed = true; },
  };
  let text = '';
  let starts = 0;
  let ends = 0;
  let error = '';
  const calls: { url: string; init?: RequestInit }[] = [];
  const recognition = new LiveRecognition({
    microphone: options.microphone ?? (async () => stream),
    peer: () => pc as unknown as RTCPeerConnection,
    request: options.request ?? (async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith('/voice/session') ? Response.json({ clientSecret: 'short-lived' }) : new Response('answer-sdp');
    }),
  });
  recognition.onstart = () => starts++;
  recognition.onend = () => ends++;
  recognition.onerror = (event) => { error = event.message || event.error; };
  recognition.onresult = (event) => { text = event.results[0]![0]!.transcript; };
  const emit = (type: string, extra = {}) => channel.onmessage?.({ data: JSON.stringify({ type: `conversation.item.input_audio_transcription.${type}`, item_id: 'turn-1', ...extra }) });
  t.after(() => recognition.abort());
  return { recognition, track, stream, pc, channel, calls, sent, emit, get text() { return text; }, get starts() { return starts; }, get ends() { return ends; }, get error() { return error; }, get peerClosed() { return peerClosed; }, get remoteSet() { return remoteSet; } };
}

test('streams each live delta immediately, replaces with final text and closes all media', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.recognition.lang = 'en-GB';
  h.recognition.context = 'Kyoto';
  h.recognition.start();
  await flush();
  assert.equal(h.remoteSet, true);
  assert.equal(h.track.enabled, false);
  assert.deepEqual(JSON.parse(String(h.calls[0]!.init?.body)), { language: 'en', context: 'Kyoto' });
  assert.equal(new Headers(h.calls[1]!.init?.headers).get('authorization'), 'Bearer short-lived');
  h.channel.onopen?.();
  assert.equal(h.starts, 1);
  assert.equal(h.track.enabled, true);
  h.emit('delta', { delta: 'September ' });
  assert.equal(h.text, 'September ');
  h.emit('delta', { delta: 'fifth' });
  assert.equal(h.text, 'September fifth');
  h.recognition.stop();
  assert.equal(h.track.stops, 1);
  t.mock.timers.tick(150);
  assert.deepEqual(h.sent.map((value) => JSON.parse(value)), [{ type: 'input_audio_buffer.commit' }]);
  h.emit('completed', { transcript: 'September 5th.' });
  assert.equal(h.text, 'September 5th.');
  assert.equal(h.ends, 1);
  assert.equal(h.peerClosed, true);
});

test('cancellation while permission is pending stops a late microphone without opening a peer', async (t) => {
  let allow!: (stream: MediaStream) => void;
  const h = harness(t, { microphone: () => new Promise((resolve) => { allow = resolve; }) });
  h.recognition.start();
  h.recognition.abort();
  allow(h.stream);
  await flush();
  assert.equal(h.track.stops, 1);
  assert.equal(h.remoteSet, false);
  assert.equal(h.starts, 0);
});

test('cancel ignores queued transcript events and stops tracks; permission errors are actionable', async (t) => {
  const h = harness(t);
  h.recognition.start();
  await flush();
  const late = h.channel.onmessage!;
  h.recognition.abort();
  late({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'turn-1', delta: 'stale' }) });
  assert.equal(h.text, '');
  assert.equal(h.track.stops, 1);
  const denied = harness(t, { microphone: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  denied.recognition.start();
  await flush();
  assert.equal(denied.error, 'not-allowed');
});

test('connection and provider failures terminate media without discarding prior transcript', async (t) => {
  const h = harness(t);
  h.recognition.start();
  await flush();
  h.emit('delta', { delta: 'Keep this' });
  h.pc.connectionState = 'failed';
  h.pc.onconnectionstatechange?.();
  assert.equal(h.text, 'Keep this');
  assert.match(h.error, /interrupted/);
  assert.equal(h.track.stops, 1);
  const failure = harness(t, { request: async () => Response.json({ error: 'Check API billing' }, { status: 429 }) });
  failure.recognition.start();
  await flush();
  assert.equal(failure.error, 'Check API billing');
  assert.equal(failure.track.stops, 1);
});
