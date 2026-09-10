import type { IncomingMessage, ServerResponse } from 'node:http';

export const voiceModel = 'gpt-live-transcribe';
export const voiceDelay = 'minimal';

export function voiceSession(language: string, context: string) {
  return {
    type: 'transcription',
    audio: { input: {
      transcription: {
        model: voiceModel,
        delay: voiceDelay,
        languages: [language],
        prompt: `Travel planning dictation: destinations, dates, transport and accommodation. Existing trip context (may be corrected by the speaker): ${context}`,
      },
      // Live deltas arrive before commit; only Stop ends the single audio turn.
      turn_detection: null,
    } },
  };
}

// Local-only endpoint. The durable API key never leaves the server. The browser
// receives a short-lived session credential for a direct WebRTC audio connection.
export function createVoiceHandler(config: { webOrigin: string; openAiApiKey: string }, request: typeof fetch = fetch) {
  let windowStart = 0;
  let attempts = 0;
  let pending = 0;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      if (!res.destroyed && !res.writableEnded) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    };
    if (req.headers.origin !== config.webOrigin) { reply(403, { error: 'Open dictation from the configured TripDock address.' }); return; }
    res.setHeader('Access-Control-Allow-Origin', config.webOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }).end();
      return;
    }
    if (req.method !== 'POST') { reply(405, { error: 'Use POST.' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'Expected JSON.' }); return; }
    if (!config.openAiApiKey) { reply(503, { error: 'Set OPENAI_API_KEY in the API configuration to use live dictation.' }); return; }
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); attempts = 0; }
    if (attempts >= 12 || pending >= 2) { reply(429, { error: 'Too many dictation starts. Wait a moment and try again.' }); return; }
    attempts++;
    pending++;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); reply(504, { error: 'Live dictation took too long to connect. Try again.' }); req.destroy(); }, 12000);
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 8192) { reply(413, { error: 'Dictation context is too long.' }); return; }
      }
      let input: { language?: unknown; context?: unknown };
      try { input = JSON.parse(raw); } catch { reply(400, { error: 'Invalid JSON.' }); return; }
      if (!input || typeof input.language !== 'string' || !/^[a-z]{2,3}$/.test(input.language) || typeof input.context !== 'string' || input.context.length > 2000) {
        reply(400, { error: 'Invalid dictation language or context.' }); return;
      }
      const upstream = await request('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${config.openAiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: voiceSession(input.language, input.context) }),
      });
      if (!upstream.ok) {
        reply(upstream.status === 429 ? 429 : 502, { error: upstream.status === 429
          ? 'OpenAI’s usage limit was reached. Check API billing or retry later.'
          : 'OpenAI could not start GPT Live Transcribe. Check the API key and model access.' });
        return;
      }
      const body = await upstream.json() as { value?: string };
      if (!body.value) throw new Error('Missing session credential');
      reply(200, { clientSecret: body.value, model: voiceModel, delay: voiceDelay });
    } catch {
      if (!res.headersSent) reply(502, { error: 'Could not connect to OpenAI live dictation. Check your connection and try again.' });
    } finally {
      clearTimeout(timeout);
      res.off('close', cancel);
      pending--;
    }
  };
}
