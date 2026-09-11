import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { createVoiceHandler, voiceSession } from '../src/voice.js';

async function harness(t: TestContext, request: typeof fetch, key = 'server-only-test-key') {
  const handler = createVoiceHandler({ webOrigin: 'http://localhost:3202', openAiApiKey: key }, request);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/voice/session`;
  const post = (body: unknown = { language: 'en', context: 'Tokyo and Kyoto' }, origin = 'http://localhost:3202') => fetch(url, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { post, url };
}

test('issues only a short-lived credential with the exact live model and minimum delay', async (t) => {
  let calls = 0;
  const h = await harness(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/realtime/client_secrets');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-test-key');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.expires_after, { anchor: 'created_at', seconds: 60 });
    assert.deepEqual(body.session, voiceSession('en', 'Tokyo and Kyoto'));
    assert.equal(body.session.audio.input.transcription.model, 'gpt-live-transcribe');
    assert.equal(body.session.audio.input.transcription.delay, 'minimal');
    assert.equal(body.session.audio.input.turn_detection, null);
    assert.equal(body.session.type, 'transcription');
    return Response.json({ value: 'ephemeral-test-value', internal: 'must not leak' });
  });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3202');
  assert.deepEqual(await response.json(), { clientSecret: 'ephemeral-test-value', model: 'gpt-live-transcribe', delay: 'minimal' });
  assert.equal(calls, 1);
});

test('rejects foreign origins, invalid context/language and missing configuration before spending', async (t) => {
  const forbidden: typeof fetch = async () => { assert.fail('Should not contact OpenAI'); };
  const h = await harness(t, forbidden);
  assert.equal((await h.post(undefined, 'https://untrusted.example')).status, 403);
  assert.equal((await h.post({ language: 'en-GB', context: '' })).status, 400);
  assert.equal((await h.post({ language: 'en', context: 'a'.repeat(2001) })).status, 400);
  assert.equal((await h.post(null)).status, 400);
  assert.equal((await fetch(h.url, { headers: { origin: 'http://localhost:3202' } })).status, 405);
  const preflight = await fetch(h.url, { method: 'OPTIONS', headers: { origin: 'http://localhost:3202' } });
  assert.equal(preflight.status, 204);
  const missing = await harness(t, forbidden, '');
  assert.equal((await missing.post()).status, 503);
});

test('provider failures never disclose the provider body or key and retries are bounded', async (t) => {
  let calls = 0;
  const h = await harness(t, async () => { calls++; return Response.json({ error: 'secret provider details' }, { status: 401 }); });
  const response = await h.post();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret provider details|server-only-test-key/);
  for (let i = 0; i < 11; i++) await h.post();
  assert.equal((await h.post()).status, 429);
  assert.equal(calls, 12);
});
