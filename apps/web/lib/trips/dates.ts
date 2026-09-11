import { type TripStop } from './types.ts';

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const month = (date: Date) =>
    date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (sameMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${start.getUTCDate()} ${month(start)}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${month(start)} ${start.getUTCFullYear()}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
}

export function formatDateTime(value: string | null, timezone: string | null): string {
  if (!value) return 'Timing not set';
  try {
    const formatted = new Date(value).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone ?? undefined,
    });
    return timezone ? `${formatted} · ${timezone}` : formatted;
  } catch {
    return `${new Date(value).toLocaleString('en-GB')} · Invalid timezone: ${timezone}`;
  }
}

export function zonedParts(value: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

export function isoToDateTimeLocal(value: string | null, timezone: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!timezone) {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  let parts: Record<string, string>;
  try {
    parts = zonedParts(date, timezone);
  } catch {
    throw new RangeError(`Use a valid IANA timezone instead of “${timezone}”.`);
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalToIso(value: string | null, timezone: string | null): string | null {
  if (!value) return null;
  if (!timezone) return new Date(value).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Use a valid local date and time.');
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(desired[0]!, desired[1]! - 1, desired[2]!, desired[3]!, desired[4]!);
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let parts: Record<string, string>;
    try {
      parts = zonedParts(new Date(candidate), timezone);
    } catch {
      throw new RangeError(`Use a valid IANA timezone instead of “${timezone}”.`);
    }
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    candidate += desiredUtc - represented;
  }
  const resolved = isoToDateTimeLocal(new Date(candidate).toISOString(), timezone);
  if (resolved !== value) {
    throw new RangeError(`That local time does not exist in ${timezone}.`);
  }
  return new Date(candidate).toISOString();
}

export function dateTimeLocalToIsoPreserving(
  value: string | null,
  timezone: string | null,
  originalIso: string | null,
): string | null {
  if (originalIso && isoToDateTimeLocal(originalIso, timezone) === value) return originalIso;
  return dateTimeLocalToIso(value, timezone);
}

export function stayDateTimesForStop(
  stop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): { checkIn: string | null; checkOut: string | null } {
  return {
    checkIn: stop?.arrivalDate ? `${stop.arrivalDate}T15:00` : null,
    checkOut: stop?.departureDate
      ? `${stop.departureDate}T${stop.departureDate === stop.arrivalDate ? '17:00' : '11:00'}`
      : null,
  };
}

export function transportDateTimesForStops(
  fromStop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
  toStop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): { departureTime: string | null; arrivalTime: string | null } {
  const departureDate = fromStop?.departureDate ?? fromStop?.arrivalDate;
  const destinationDate = toStop?.arrivalDate ?? toStop?.departureDate;
  const arrivalDate = departureDate && destinationDate && destinationDate < departureDate
    ? departureDate
    : destinationDate;
  return {
    departureTime: departureDate ? `${departureDate}T09:00` : null,
    arrivalTime: arrivalDate ? `${arrivalDate}T17:00` : null,
  };
}

export function activityDateTimeForStop(
  stop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): string | null {
  const date = stop?.arrivalDate ?? stop?.departureDate;
  return date ? `${date}T09:00` : null;
}

export function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
