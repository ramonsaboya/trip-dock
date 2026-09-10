// A small structural adapter also covers browsers with the webkit prefix.
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionConstructor = new () => Recognition;
export type DictationState = { phase: 'idle' | 'starting' | 'listening' | 'stopping'; message: string };
export const idleDictation: DictationState = { phase: 'idle', message: '' };

export function recognitionConstructor(environment: {
  isSecureContext?: boolean;
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}): RecognitionConstructor | undefined {
  if (!environment.isSecureContext) return undefined;
  return environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
}

export function appendDictation(base: string, transcript: string, maxLength: number): string {
  const words = transcript.trim();
  const separator = base && !/\s$/.test(base) && words ? ' ' : '';
  // Do not leave half of a Unicode surrogate pair at the length boundary.
  return (base + separator + words).slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, '');
}

export function recognitionError(code: string): string {
  switch (code) {
    case 'not-allowed': return 'Microphone access was denied. Allow microphone access in your browser settings, then try again.';
    case 'service-not-allowed': return 'Your browser’s speech service is unavailable or blocked. Try another supported browser or keep typing.';
    case 'audio-capture': return 'No microphone is available. Check your microphone connection and system permissions.';
    case 'network': return 'The speech service could not connect. Check your connection and try again.';
    case 'no-speech': return 'No speech was detected. Click Speak to try again, or keep typing.';
    case 'language-not-supported': return 'The speech service does not support your browser language. You can keep typing.';
    case 'aborted': return 'Dictation stopped. Review your text before sending.';
    default: return 'Dictation could not continue. Your text is still editable; try again or keep typing.';
  }
}

// Each session owns a fixed prefix. Result events contain the whole session,
// including revised/removed interim hypotheses; never append event deltas.
export class VoiceDictation {
  private recognition: Recognition | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private phase: DictationState['phase'] = 'idle';
  private disposed = false;
  private create: RecognitionConstructor;
  private onText: (text: string) => void;
  private onState: (state: DictationState) => void;

  constructor(create: RecognitionConstructor, onText: (text: string) => void, onState: (state: DictationState) => void) {
    this.create = create;
    this.onText = onText;
    this.onState = onState;
  }

  private publish(phase: DictationState['phase'], message: string) {
    this.phase = phase;
    if (!this.disposed) this.onState({ phase, message });
  }

  get active() { return this.recognition !== null; }

  start(base: string, maxLength: number, language: string) {
    if (this.disposed || this.recognition) return;
    if (base.length >= maxLength) {
      this.publish('idle', 'The text limit is reached. Shorten your message before dictating more.');
      return;
    }
    let receivedText = false;
    try {
      const recognition = new this.create();
      this.recognition = recognition;
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      const current = () => !this.disposed && this.recognition === recognition;
      recognition.onstart = () => {
        if (!current() || this.phase !== 'starting') return;
        clearTimeout(this.timer);
        this.publish('listening', 'Listening… Words may change as you speak. Typing stops dictation.');
      };
      recognition.onresult = (event) => {
        if (!current()) return;
        const transcript = Array.from(event.results, (result) => result[0]?.transcript.trim() ?? '').filter(Boolean).join(' ');
        const text = appendDictation(base, transcript, maxLength);
        receivedText = text !== base;
        this.onText(text);
        if (text.length >= maxLength) this.cancel('Text limit reached. Review your message before sending.');
      };
      recognition.onerror = ({ error }) => {
        if (current()) this.cancel(recognitionError(error));
      };
      recognition.onend = () => {
        if (!current()) return;
        this.release(false);
        this.publish('idle', receivedText ? 'Dictation stopped. Review your text before sending.' : 'No speech was captured. Click Speak to try again.');
      };
      this.publish('starting', 'Starting microphone… Allow access if your browser asks.');
      this.timer = setTimeout(() => this.cancel('The microphone did not start. Check browser permissions and try again.'), 15000);
      recognition.start();
    } catch (error) {
      this.cancel(recognitionError(error instanceof Error && error.name === 'NotAllowedError' ? 'not-allowed' : 'unknown'));
    }
  }

  stop() {
    if (!this.recognition || this.phase === 'stopping') return;
    if (this.phase === 'starting') {
      this.cancel('Dictation cancelled. You can keep typing.');
      return;
    }
    clearTimeout(this.timer);
    this.publish('stopping', 'Finishing dictation…');
    this.timer = setTimeout(() => this.cancel('Dictation stopped. Review your text before sending.'), 2000);
    try { this.recognition.stop(); } catch { this.cancel('Dictation stopped. Review your text before sending.'); }
  }

  cancel(message = 'Dictation stopped so you can edit. Review your text before sending.') {
    if (this.disposed) return;
    this.release(true);
    this.publish('idle', message);
  }

  private release(abort: boolean) {
    clearTimeout(this.timer);
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
    if (abort) {
      try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
    }
  }

  dispose() {
    this.disposed = true;
    this.release(true);
  }
}
