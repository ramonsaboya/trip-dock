'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { idleDictation, recognitionConstructor, VoiceDictation } from '../lib/voice-dictation';

type Props = {
  id: string;
  rows: number;
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
  onActiveChange: (active: boolean) => void;
  placeholder: string;
  disabled?: boolean;
};

const subscribeToSupport = () => () => {};
const clientSupport = () => Boolean(recognitionConstructor(window));
const serverSupport = () => null;

export function DictationTextarea({ id, rows, maxLength, value, onChange, onActiveChange, placeholder, disabled = false }: Props) {
  const supported = useSyncExternalStore(subscribeToSupport, clientSupport, serverSupport);
  const [state, setState] = useState(idleDictation);
  const session = useRef<VoiceDictation | null>(null);
  const callbacks = useRef({ onChange, onActiveChange });
  useEffect(() => { callbacks.current = { onChange, onActiveChange }; }, [onChange, onActiveChange]);

  useEffect(() => {
    const Constructor = recognitionConstructor(window);
    if (!Constructor) return;
    const controller = new VoiceDictation(Constructor,
      (text) => callbacks.current.onChange(text),
      (next) => { setState(next); callbacks.current.onActiveChange(next.phase !== 'idle'); });
    session.current = controller;
    const pause = () => { if (controller.active) controller.cancel('Dictation paused. Review your text or click Speak to continue.'); };
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
  const helpId = `${id}-voice-help`;
  const statusId = `${id}-voice-status`;

  return (
    <div className="dictation-compose">
      <textarea id={id} rows={rows} maxLength={maxLength} value={value} placeholder={placeholder} disabled={disabled}
        aria-describedby={`${helpId} ${statusId}`}
        onChange={(event) => {
          if (active) session.current?.cancel();
          onChange(event.target.value);
        }}
        onCompositionStart={() => { if (active) session.current?.cancel(); }} />
      <div className="dictation-toolbar">
        <button type="button" className="button-secondary dictation-toggle" aria-controls={id} aria-pressed={active}
          disabled={disabled || !supported || state.phase === 'stopping'}
          onClick={() => active ? session.current?.stop() : session.current?.start(value, maxLength, navigator.language || 'en-GB')}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {active ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}
          </svg>
          {state.phase === 'starting' ? 'Cancel dictation' : state.phase === 'stopping' ? 'Finishing…' : active ? 'Stop dictation' : 'Speak'}
        </button>
        <span id={statusId} className="dictation-status" role="status" aria-live="polite" aria-atomic="true">{state.message}</span>
      </div>
      <p id={helpId} className="dictation-help">{supported === false
        ? 'Voice input is unavailable here. Try Chrome or Safari on HTTPS or localhost, or keep typing.'
        : 'Speech is added at the end. Your browser may send audio to its speech service. Review before sending.'}</p>
    </div>
  );
}
