import { dateTimeLocalToIso, isoToDateTimeLocal, type Activity, type TripStop } from './graphql-client.ts';

export const calendarHours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0') + ':00');

export function destinationDays(stop: Pick<TripStop, 'arrivalDate' | 'departureDate'>): string[] {
  if (!stop.arrivalDate || !stop.departureDate) return [];
  const days: string[] = [];
  const date = new Date(`${stop.arrivalDate}T12:00:00Z`);
  const end = new Date(`${stop.departureDate}T12:00:00Z`);
  while (date <= end) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

export function activityAssignment(activity: Pick<Activity, 'scheduledAt' | 'timezone'>) {
  const local = isoToDateTimeLocal(activity.scheduledAt, activity.timezone);
  if (!local) return null;
  return { day: local.slice(0, 10), time: local.slice(11, 16), hour: local.slice(11, 13) + ':00' };
}

export function activityMoveInput(activity: Activity, stopId: string, day: string, time: string, timezone: string) {
  if (day && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid time.');
  return {
    stopId, title: activity.title, status: activity.status, durationMinutes: activity.durationMinutes ?? 60,
    scheduledAt: day ? dateTimeLocalToIso(`${day}T${time}`, timezone) : null,
    timezone: day ? timezone : activity.timezone,
  };
}
