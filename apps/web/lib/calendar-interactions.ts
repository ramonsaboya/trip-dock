export type CellFeedback = { selected: string; start: number; end: number };
const empty: CellFeedback = { selected: '', start: 0, end: 0 };

// Transient feedback is subscribed to by affected cells, never by the whole trip.
export function createCalendarInteractions() {
  const listeners = new Map<string, Set<() => void>>();
  const snapshots = new Map<string, CellFeedback>();
  let selected = '';
  let dropped: string[] = [];
  function update(key: string, value: CellFeedback) {
    const previous = snapshots.get(key) ?? empty;
    if (previous.selected === value.selected && previous.start === value.start && previous.end === value.end) return;
    if (!value.selected && value.start === value.end) snapshots.delete(key);
    else snapshots.set(key, value);
    listeners.get(key)?.forEach((listener) => listener());
  }
  const get = (key: string) => snapshots.get(key) ?? empty;
  return {
    get,
    subscribe(key: string, listener: () => void) {
      const bucket = listeners.get(key) ?? new Set();
      bucket.add(listener); listeners.set(key, bucket);
      return () => { bucket.delete(listener); if (!bucket.size) listeners.delete(key); };
    },
    select(value: string) {
      const key = value ? value.slice(0, 13) + ':00' : '';
      if (selected && selected !== key) update(selected, { ...get(selected), selected: '' });
      selected = key;
      if (key) update(key, { ...get(key), selected: value.slice(11) });
    },
    drop(day: string, start = 0, duration = 0) {
      const next = new Map<string, CellFeedback>();
      if (day === 'pool') next.set('pool', { selected: '', start: 0, end: 1 });
      else if (day && duration > 0) {
        for (let hour = Math.max(0, Math.floor(start / 60)); hour < 24 && hour * 60 < start + duration; hour++) {
          const key = day + '-' + String(hour).padStart(2, '0') + ':00';
          next.set(key, { ...get(key), start: Math.max(start, hour * 60) - hour * 60, end: Math.min(start + duration, (hour + 1) * 60) - hour * 60 });
        }
      }
      for (const key of dropped) if (!next.has(key)) update(key, { ...get(key), start: 0, end: 0 });
      for (const [key, value] of next) update(key, value);
      dropped = [...next.keys()];
    },
  };
}

export type CalendarInteractions = ReturnType<typeof createCalendarInteractions>;
