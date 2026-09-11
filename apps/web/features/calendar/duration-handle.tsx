'use client';

import { useEffect, useRef, useState } from 'react';
import { slotHeight } from '../../lib/trip-calendar';

export function DurationHandle({ edge, minutes, max, disabled, onPreview, onCommit, onCancel }: { edge: 'top' | 'bottom'; minutes: number; max: number; disabled: boolean; onPreview: (minutes: number) => void; onCommit: (minutes: number) => void; onCancel: () => void }) {
  const drag = useRef<{ y: number; initial: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  const frame = useRef<number | null>(null);
  function cancelFrame() { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const clamp = (value: number) => Math.max(30, Math.min(max, Math.round(value / 30) * 30));
  return <button type="button" className={`card-duration-handle resize-${edge}`} disabled={disabled} draggable={false} role="slider" aria-label={edge === 'top' ? 'Resize start time' : 'Resize end time'} aria-valuemin={30} aria-valuemax={max} aria-valuenow={minutes} aria-valuetext={minutes + ' minutes'}
    onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, initial: minutes, value: minutes }; setActive(true); }}
    onPointerMove={(event) => { if (!drag.current) return; event.stopPropagation(); const value = clamp(drag.current.initial + (event.clientY - drag.current.y) / slotHeight * 30 * (edge === 'top' ? -1 : 1)); if (value !== drag.current.value) { drag.current.value = value; if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) onPreview(drag.current.value); }); } }}
    onPointerUp={(event) => { event.stopPropagation(); const current = drag.current; cancelFrame(); drag.current = null; setActive(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current && current.value !== current.initial) { onPreview(current.value); onCommit(current.value); } else if (current) onCancel(); }}
    onPointerCancel={() => { cancelFrame(); if (drag.current) onCancel(); drag.current = null; setActive(false); }} onLostPointerCapture={() => { cancelFrame(); if (drag.current) onCancel(); drag.current = null; setActive(false); }}
    onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onCommit(clamp(minutes + (event.key === 'ArrowDown' ? 30 : -30) * (edge === 'top' ? -1 : 1))); } }}>
    <span aria-hidden="true">{active ? minutes + ' min' : '⋯'}</span>
  </button>;
}
