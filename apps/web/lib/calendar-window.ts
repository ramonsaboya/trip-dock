// Fixed-width day columns need no measuring cache or virtualizer dependency.
// Headers keep the full column model; body spacers preserve identical geometry.
export function calendarDayWindow(count: number, left: number, width: number, dayWidth: number, overscan = 2) {
  if (count <= 14 || dayWidth <= 0) return { start: 0, end: count };
  const start = Math.min(count, Math.max(0, Math.floor(left / dayWidth) - overscan));
  const end = Math.min(count, Math.max(start, Math.ceil((left + Math.max(0, width - 62)) / dayWidth) + overscan));
  return { start, end };
}

export function calendarColumnRuns(count: number, start: number, end: number, pinned: number[] = []) {
  const indices = new Set(pinned.filter((index) => index >= 0 && index < count));
  for (let index = start; index < Math.min(count, end); index++) indices.add(index);
  const runs: { index: number; span: number; spacer: boolean }[] = [];
  let cursor = 0;
  for (const index of [...indices].sort((a, b) => a - b)) {
    if (index > cursor) runs.push({ index: cursor, span: index - cursor, spacer: true });
    runs.push({ index, span: 1, spacer: false });
    cursor = index + 1;
  }
  if (cursor < count) runs.push({ index: cursor, span: count - cursor, spacer: true });
  return runs;
}
