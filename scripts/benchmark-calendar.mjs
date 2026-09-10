import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { calendarEventIndex, calendarPaperResolver, calendarColumns } from '../apps/web/lib/trip-calendar.ts';
import { calendarHours, activityAssignment } from '../apps/web/lib/activity-planning.ts';

// Compare pure data preparation, not browser rendering. Optional ref defaults to
// the last tested calendar before this optimization. No working files are changed.
const baselineRef = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'eb10981';
const directory = mkdtempSync(join(tmpdir(), 'tripdock-calendar-bench-'));
try {
  let source = execFileSync('git', ['show', `${baselineRef}:apps/web/lib/trip-calendar.ts`], { encoding: 'utf8' });
  for (const file of ['graphql-client.ts', 'activity-planning.ts']) source = source.replaceAll(`'./${file}'`, JSON.stringify(pathToFileURL(resolve('apps/web/lib', file)).href));
  const baselineFile = join(directory, 'baseline.ts');
  writeFileSync(baselineFile, source);
  const legacy = await import(pathToFileURL(baselineFile).href);
  const day = (offset) => new Date(Date.UTC(2027, 5, 1 + offset)).toISOString().slice(0, 10);
  function fixture(days, count) {
    const trip = { id: 'benchmark', startDate: day(0), endDate: day(days - 1), stops: [], activities: [], stays: [], transportLegs: [] };
    for (let offset = 0; offset < days; offset += 4) trip.stops.push({ id: `stop-${offset}`, position: offset, name: `City ${offset}`, arrivalDate: day(offset), departureDate: day(Math.min(days - 1, offset + 4)) });
    trip.activities = Array.from({ length: count }, (_, i) => ({ id: `activity-${i}`, position: i, stopId: trip.stops[Math.floor((i % days) / 4)].id, title: 'Activity', status: 'IDEA', scheduledAt: `${day(i % days)}T${String(8 + i % 12).padStart(2, '0')}:30:00Z`, timezone: 'Europe/Rome', durationMinutes: 90 }));
    trip.transportLegs = trip.stops.slice(1).map((stop, i) => ({ id: `leg-${i}`, fromStopId: trip.stops[i].id, toStopId: stop.id, departureTime: `${stop.arrivalDate}T08:00:00Z`, arrivalTime: `${stop.arrivalDate}T09:30:00Z`, timezone: 'Europe/Rome' }));
    return trip;
  }
  function oldWork(trip) {
    let checksum = 0;
    for (const { day } of calendarColumns(trip)) for (const hour of calendarHours) {
      checksum += Number(Boolean(legacy.calendarHourDestination(trip, day, hour)));
      for (const time of [hour, hour.slice(0, 2) + ':30']) {
        checksum += Number(Boolean(legacy.calendarHourDestination(trip, day, time)));
        checksum += Number(Boolean(legacy.calendarTransition(trip, day, time)));
      }
      checksum += trip.activities.filter((item) => { const place = activityAssignment(item); return place?.day === day && place.hour === hour; }).length;
      checksum += trip.transportLegs.filter((item) => { const place = legacy.transportPlacement(item, trip.stops); return place.day === day && legacy.transportLocalTime(item).slice(0, 2) + ':00' === hour; }).length;
    }
    return checksum;
  }
  function newWork(trip) {
    const index = calendarEventIndex(trip); const resolvePaper = calendarPaperResolver(trip);
    let checksum = 0;
    for (const { day } of calendarColumns(trip)) for (const hour of calendarHours) {
      const paper = resolvePaper(day); const time = Number(hour.slice(0, 2));
      checksum += Number(Boolean(paper.destination(time)));
      for (const half of [time, time + .5]) { checksum += Number(Boolean(paper.destination(half))); checksum += Number(Boolean(paper.transition(half))); }
      checksum += (index.activities.get(day + '-' + hour) ?? []).length;
      checksum += (index.transport.get(day + '-' + hour) ?? []).length;
    }
    return checksum;
  }
  const measure = (fn, trip) => { const start = performance.now(); const checksum = fn(trip); return { ms: performance.now() - start, checksum }; };
  for (const [days, activities] of (process.argv.includes('--stress') ? [[7, 40], [30, 300], [90, 1500]] : [[7, 40], [30, 300]])) {
    const trip = fixture(days, activities);
    const before = measure(oldWork, trip); const after = measure(newWork, trip);
    if (before.checksum !== after.checksum) throw new Error('Benchmark output mismatch');
    console.log(JSON.stringify({ days, activities, baselineMs: +before.ms.toFixed(2), optimizedMs: +after.ms.toFixed(2), checksum: after.checksum }));
  }
} finally {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('tripdock-calendar-bench-')) throw new Error('Unexpected benchmark cleanup directory');
  rmSync(target, { recursive: true });
}
