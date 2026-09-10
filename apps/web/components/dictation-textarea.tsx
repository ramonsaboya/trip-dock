'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { idleDictation, VoiceDictation } from '../lib/voice-dictation';
import { LiveRecognition, liveRecognitionSupported } from '../lib/live-recognition';

type Props = {
  id: string;
  rows: number;
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
  onActiveChange: (active: boolean) => void;
  onVoiceUsed: () => void;
  placeholder: string;
  disabled?: boolean;
  context?: string;
};

const subscribeToSupport = () => () => {};
const clientSupport = () => liveRecognitionSupported();
const serverSupport = () => null;

export function VoiceAttribution({ visible }: { visible: boolean }) {
  return <span className="voice-attribution" style={{ visibility: visible ? 'visible' : 'hidden' }} aria-hidden={!visible}>
    <span>GPT Live Transcribe</span><small>Audio sent to OpenAI</small>
  </span>;
}

export function DictationTextarea({ id, rows, maxLength, value, onChange, onActiveChange, onVoiceUsed, placeholder, disabled = false, context }: Props) {
  const supported = useSyncExternalStore(subscribeToSupport, clientSupport, serverSupport);
  const [state, setState] = useState(idleDictation);
  const session = useRef<VoiceDictation | null>(null);
  const callbacks = useRef({ onChange, onActiveChange });
  useEffect(() => { callbacks.current = { onChange, onActiveChange }; }, [onChange, onActiveChange]);

  useEffect(() => {
    if (!liveRecognitionSupported()) return;
    const controller = new VoiceDictation(LiveRecognition,
      (text) => callbacks.current.onChange(text),
      (next) => { setState(next); callbacks.current.onActiveChange(next.phase !== 'idle'); });
    session.current = controller;
    const pause = () => { if (controller.active) controller.cancel('Dictation paused. Click the microphone to continue.'); };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
      controller.dispose();
      session.current = null;
      callbacks.current.onActiveChange(false);
    };
  }, []);

  useEffect(() => { if (disabled && session.current?.active) session.current.cancel(); }, [disabled]);
  const active = state.phase !== 'idle';
  const starting = state.phase === 'starting';
  const listening = state.phase === 'listening';
  const statusId = `${id}-voice-status`;
  const buttonLabel = starting ? 'Cancel dictation' : state.phase === 'stopping' ? 'Finishing dictation' : listening ? 'Stop dictation' : 'Start dictation';
  const status = starting ? 'Getting ready… Wait to speak. Allow microphone access if prompted.'
    : listening ? 'Listening — speak now'
    : state.phase === 'stopping' ? 'Finishing dictation…'
    : supported === false ? 'Voice unavailable here. You can keep typing.'
    : state.message;

  return (
    <div className="dictation-compose" data-phase={state.phase}>
      <textarea id={id} rows={rows} maxLength={maxLength} value={value} placeholder={placeholder} disabled={disabled}
        readOnly={starting} aria-busy={starting} aria-describedby={statusId}
        onChange={(event) => {
          if (active) session.current?.cancel();
          onChange(event.target.value);
        }}
        onCompositionStart={() => { if (active) session.current?.cancel(); }} />
      {starting ? <div className="dictation-preparing" aria-hidden="true">
        <span className="dictation-spinner" />
        <strong>Getting ready…</strong>
        <span>Wait to speak</span>
        <small>Allow microphone access if prompted</small>
      </div> : null}
      <span id={statusId} className={starting ? 'dictation-announcement' : 'dictation-status'} role="status" aria-live="polite" aria-atomic="true">
        {listening ? <span className="dictation-live-dot" aria-hidden="true" /> : null}
        {state.phase === 'stopping' ? <span className="dictation-spinner dictation-spinner-small" aria-hidden="true" /> : null}
        {status}
      </span>
      <button type="button" className="dictation-toggle" aria-label={buttonLabel} aria-controls={id} aria-pressed={active}
        title={active ? buttonLabel : 'Dictate with your microphone · audio sent to OpenAI'}
        disabled={disabled || !supported || state.phase === 'stopping'}
        onClick={() => {
          if (active) session.current?.stop();
          else {
            onVoiceUsed();
            session.current?.start(value, maxLength, navigator.language || 'en-GB', [context, value].filter(Boolean).join('\n'));
          }
        }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          {starting ? <path d="m6 6 12 12M6 18 18 6" /> : active ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}
        </svg>
      </button>
    </div>
  );
}
