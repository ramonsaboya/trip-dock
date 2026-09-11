'use client';

import { useRef, useState } from 'react';

export function CountInput({ value, max, label, disabled, onSave }: { value: number; max: number; label: string; disabled: boolean; onSave: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) { cancelled.current = false; setDraft(String(value)); return; }
    const number = Number(draft);
    if (draft !== '' && Number.isInteger(number) && number >= 0 && number <= max && number !== value) void onSave(number).then(saved => { if (!saved) setDraft(String(value)); });
    else setDraft(String(value));
  }
  return <input aria-label={label} type="number" min={0} max={max} disabled={disabled} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } }} />;
}
