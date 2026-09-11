'use client';

import { useCallback, useSyncExternalStore, type TdHTMLAttributes } from 'react';
import { type CalendarInteractions } from '../../lib/calendar-interactions';

export function CalendarCell({ feedback, cellKey, onAdd, children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { feedback: CalendarInteractions; cellKey: string; onAdd: (time: string) => void }) {
  const subscribe = useCallback((listener: () => void) => feedback.subscribe(cellKey, listener), [feedback, cellKey]);
  const get = useCallback(() => feedback.get(cellKey), [feedback, cellKey]);
  const state = useSyncExternalStore(subscribe, get, get);
  return <td {...props} className={className + (state.selected ? ' cell-selected' : '')}>
    {children}
    {state.end > state.start ? <span className="calendar-drop-preview" aria-hidden="true" style={{ top: state.start / 60 * 100 + '%', height: (state.end - state.start) / 60 * 100 + '%' }} /> : null}
    {state.selected ? <button type="button" className="cell-add-activity" aria-label={'Add activity at ' + state.selected} onClick={() => onAdd(state.selected)}>+</button> : null}
  </td>;
}
