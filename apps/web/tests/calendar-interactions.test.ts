import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarInteractions } from '../lib/calendar-interactions.ts';
import { calendarColumnRuns, calendarDayWindow } from '../lib/calendar-window.ts';

test('hover selection notifies only the old and new cells, preserving half-hour time', () => {
  const store = createCalendarInteractions();
  const a = '2027-06-01-09:00'; const b = '2027-06-02-11:00';
  const notifications: string[] = [];
  store.subscribe(a, () => notifications.push(a));
  store.subscribe(b, () => notifications.push(b));
  store.subscribe('2027-06-03-10:00', () => assert.fail('Unrelated cell was notified'));
  store.select('2027-06-01-09:30');
  assert.equal(store.get(a).selected, '09:30');
  const snapshot = store.get(a);
  store.select('2027-06-01-09:30');
  assert.equal(store.get(a), snapshot);
  store.select('2027-06-02-11:00');
  store.select('');
  assert.deepEqual(notifications, [a, a, b, b]);
  assert.equal(store.get(a).selected, '');
  assert.equal(store.get(b).selected, '');
});

test('drop preview spans exact half-hours and clears stale cells when moving to the pool', () => {
  const store = createCalendarInteractions();
  const key = (hour: string) => '2027-06-01-' + hour;
  store.drop('2027-06-01', 570, 120);
  assert.deepEqual(store.get(key('09:00')), { selected: '', start: 30, end: 60 });
  assert.deepEqual(store.get(key('10:00')), { selected: '', start: 0, end: 60 });
  assert.deepEqual(store.get(key('11:00')), { selected: '', start: 0, end: 30 });
  assert.equal(store.get(key('12:00')).end, 0);
  store.drop('pool');
  assert.equal(store.get(key('09:00')).end, 0);
  assert.equal(store.get(key('11:00')).end, 0);
  assert.equal(store.get('pool').end, 1);
  store.drop('');
  assert.equal(store.get('pool').end, 0);
});

test('removing subscriptions and repeating a drag target performs no extra notifications', () => {
  const store = createCalendarInteractions();
  let calls = 0;
  const unsubscribe = store.subscribe('2027-06-01-10:00', () => calls++);
  store.drop('2027-06-01', 600, 30);
  store.drop('2027-06-01', 600, 30);
  assert.equal(calls, 1);
  unsubscribe();
  store.drop('');
  assert.equal(calls, 1);
});

test('day window bounds mounted columns while preserving focused/dragged columns and total width', () => {
  assert.deepEqual(calendarDayWindow(9, 0, 1000, 220), { start: 0, end: 9 });
  const range = calendarDayWindow(365, 220 * 100, 62 + 220 * 5, 220);
  assert.deepEqual(range, { start: 98, end: 107 });
  const runs = calendarColumnRuns(365, range.start, range.end, [1, 1]);
  assert.equal(runs.reduce((sum, run) => sum + run.span, 0), 365);
  assert.equal(runs.filter((run) => !run.spacer).length, 10);
  assert.ok(runs.some((run) => !run.spacer && run.index === 1));
  assert.deepEqual(calendarDayWindow(365, 220 * 364, 1162, 220), { start: 362, end: 365 });
  assert.deepEqual(calendarColumnRuns(0, 0, 0), []);
});
