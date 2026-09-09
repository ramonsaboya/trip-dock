import { dateTimeLocalToIso, isoToDateTimeLocal, type Activity, type TripStop } from './graphql-client.ts';

export const daySlots = [
  { key: 'morning', label: 'Morning', time: '09:00' },
  { key: 'afternoon', label: 'Afternoon', time: '14:00' },
  { key: 'evening', label: 'Evening', time: '19:00' },
] as const;

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
  const hour = Number(local.slice(11, 13));
  return { day: local.slice(0, 10), slot: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening' };
}

export function activityMoveInput(activity: Activity, stopId: string, day: string, slot: string, timezone: string) {
  const time = daySlots.find((item) => item.key === slot)?.time;
  if (day && !time) throw new Error('Choose a time of day.');
  return {
    stopId, title: activity.title, status: activity.status,
    scheduledAt: day ? dateTimeLocalToIso(`${day}T${time}`, timezone) : null,
    timezone: day ? timezone : activity.timezone,
  };
}
