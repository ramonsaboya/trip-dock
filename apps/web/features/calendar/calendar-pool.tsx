'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { type CalendarInteractions } from '../../lib/calendar-interactions';

export function CalendarPool({ feedback, children, ...props }: React.HTMLAttributes<HTMLElement> & { feedback: CalendarInteractions }) {
  const subscribe = useCallback((listener: () => void) => feedback.subscribe('pool', listener), [feedback]);
  const get = useCallback(() => feedback.get('pool'), [feedback]);
  const state = useSyncExternalStore(subscribe, get, get);
  return <aside {...props} className={'calendar-pool trip-calendar-pool' + (state.end ? ' drop-active' : '')}>{children}</aside>;
}
