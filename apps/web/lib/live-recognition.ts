import type { Recognition } from './voice-dictation';

export function liveRecognitionSupported() {
  return typeof window !== 'undefined' && window.isSecureContext &&
    typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

type Dependencies = {
  microphone(): Promise<MediaStream>;
  peer(): RTCPeerConnection;
  request: typeof fetch;
};

// Adapts direct WebRTC transcription to the composer's existing lifecycle.
// A session has one explicit turn, so each delta can be painted immediately.
export class LiveRecognition implements Recognition {
  lang = 'en-GB';
  context = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  finalizationTimeoutMs = 5000;
  onstart: Recognition['onstart'] = null;
  onend: Recognition['onend'] = null;
  onerror: Recognition['onerror'] = null;
  onresult: Recognition['onresult'] = null;
  private dependencies: Dependencies;
  private peerConnection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private closed = false;
  private stopping = false;
  private started = false;
  private transcript = '';
  private itemId: string | null = null;
  private abortController = new AbortController();
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private durationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dependencies: Dependencies = {
    microphone: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    peer: () => new RTCPeerConnection(),
    request: (...args) => fetch(...args),
  }) { this.dependencies = dependencies; }

  start() {
    if (this.started || this.closed) return;
    this.started = true;
    void this.connect();
  }

  private async connect() {
    try {
      const endpoint = new URL('/voice/session', process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql');
      // Overlap permission/capture setup with authentication to reduce startup.
      const credential = this.dependencies.request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.abortController.signal,
        body: JSON.stringify({ language: this.lang.split('-')[0]!.toLowerCase(), context: this.context.slice(-2000) }),
      }).then(async (response) => {
        const body = await response.json() as { clientSecret?: string; error?: string };
        if (!response.ok || !body.clientSecret) throw new Error(body.error ?? 'Could not start live dictation.');
        return body.clientSecret;
      });
      const microphone = this.dependencies.microphone().then((stream) => {
        if (this.closed) { stream.getTracks().forEach((track) => track.stop()); return stream; }
        this.stream = stream;
        // Capture starts only after the data connection is ready to show words.
        stream.getTracks().forEach((track) => { track.enabled = false; track.onended = () => this.fail('The microphone disconnected.'); });
        return stream;
      });
      // Prepare the WebRTC offer while the credential request is in flight.
      const connection = microphone.then(async (stream) => {
        if (this.closed) return;
        const pc = this.dependencies.peer();
        this.peerConnection = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        pc.onconnectionstatechange = () => {
          if (['failed', 'disconnected'].includes(pc.connectionState)) this.fail('The live dictation connection was interrupted.');
        };
        const channel = pc.createDataChannel('oai-events');
        this.channel = channel;
        channel.onmessage = (event) => {
          if (this.closed) return;
          try { this.receive(JSON.parse(event.data)); } catch { this.fail('Live dictation returned an unreadable event.'); }
        };
        channel.onopen = () => {
          if (this.closed) return;
          stream.getTracks().forEach((track) => { track.enabled = true; });
          this.durationTimer = setTimeout(() => this.fail('Dictation reached its five-minute limit. Review the text and click Speak to continue.'), 300000);
          this.onstart?.();
        };
        channel.onclose = () => { if (!this.closed) this.fail('The live dictation session ended unexpectedly.'); };
        channel.onerror = () => this.fail('The live dictation connection failed.');
        const offer = await pc.createOffer();
        if (this.closed) return;
        await pc.setLocalDescription(offer);
        if (this.closed) return;
        return { pc, offer };
      });
      const [key, prepared] = await Promise.all([credential, connection]);
      if (this.closed || !prepared) return;
      const { pc, offer } = prepared;
      const answer = await this.dependencies.request('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', body: offer.sdp, signal: this.abortController.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp' },
      });
      if (!answer.ok) throw new Error('OpenAI could not connect the microphone. Please retry.');
      const sdp = await answer.text();
      if (!this.closed) await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      if (this.closed) return;
      if (error instanceof Error && error.name === 'NotAllowedError') this.fail('', 'not-allowed');
      else if (error instanceof Error && ['NotFoundError', 'NotReadableError'].includes(error.name)) this.fail('', 'audio-capture');
      else this.fail(error instanceof Error ? error.message : 'Could not start live dictation.');
    }
  }

  private receive(event: { type: string; item_id?: string; delta?: string; transcript?: string; error?: { code?: string } }) {
    if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
      // A very short/empty turn can legitimately have nothing to commit.
      if (this.stopping && event.error?.code === 'input_audio_buffer_commit_empty') { this.finish(); return; }
      this.fail('OpenAI could not transcribe this audio. Review your text and try again.');
      return;
    }
    if (!['conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed'].includes(event.type)) return;
    if (!event.item_id) return;
    this.itemId ??= event.item_id;
    if (event.item_id !== this.itemId) { this.fail('The speech session changed unexpectedly. Review your text and restart dictation.'); return; }
    if (event.type.endsWith('.delta')) this.transcript += event.delta ?? '';
    else this.transcript = event.transcript ?? this.transcript;
    this.onresult?.({ results: [[{ transcript: this.transcript }]] });
    if (event.type.endsWith('.completed')) this.finish();
  }

  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.stopMicrophone();
    // Drain audio already in flight before committing over the data channel.
    this.commitTimer = setTimeout(() => {
      if (!this.closed && this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      else this.finish();
    }, 150);
  }

  private stopMicrophone() {
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
  }

  private fail(message: string, error = 'live-error') {
    if (this.closed) return;
    this.abort();
    this.onerror?.({ error, message });
  }

  private finish() {
    if (this.closed) return;
    this.abort();
    this.onend?.();
  }

  abort() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.commitTimer);
    clearTimeout(this.durationTimer);
    this.abortController.abort();
    this.stopMicrophone();
    if (this.channel) {
      this.channel.onopen = this.channel.onclose = this.channel.onmessage = this.channel.onerror = null;
      this.channel.close();
    }
    if (this.peerConnection) { this.peerConnection.onconnectionstatechange = null; this.peerConnection.close(); }
  }
}
