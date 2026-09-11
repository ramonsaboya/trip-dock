import { AppError, compareStopsByDate, validateDateRange, type DatedStop } from '../domain.js';

export function validateTimestampRange(start: string | null, end: string | null, label: string): void {
  if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
    throw new AppError(`The ${label} ends before it starts.`, 'BAD_USER_INPUT');
  }
}

export function orderStopsByDate<T extends DatedStop>(stops: T[]): T[] {
  return [...stops].sort(compareStopsByDate);
}

export function withLinkedTripBoundaryDates<T extends DatedStop>(
  stops: T[],
  oldStartDate: string | null,
  oldEndDate: string | null,
  newStartDate: string,
  newEndDate: string,
): T[] {
  const ordered = stops.map((stop) => ({ ...stop }));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) {
    throw new AppError('A trip must keep at least one destination.', 'BAD_USER_INPUT');
  }
  if (first.arrivalDate === oldStartDate) {
    first.arrivalDate = newStartDate;
  }
  if (last.departureDate === oldEndDate) {
    last.departureDate = newEndDate;
  }
  return ordered;
}

export function validateStopsWithinTrip(
  stops: DatedStop[],
  startDate: string,
  endDate: string,
  errorCode: 'BAD_USER_INPUT' | 'AI_INVALID_OUTPUT' = 'BAD_USER_INPUT',
): void {
  validateDateRange(startDate, endDate, 'trip date range');
  for (const stop of stops) {
    try {
      validateDateRange(stop.arrivalDate, stop.departureDate, 'destination date range');
    } catch (error) {
      if (errorCode === 'AI_INVALID_OUTPUT') {
        throw new AppError('The generated draft creates an invalid destination date range.', errorCode);
      }
      throw error;
    }
    for (const date of [stop.arrivalDate, stop.departureDate]) {
      if (date && (date < startDate || date > endDate)) {
        throw new AppError(
          errorCode === 'AI_INVALID_OUTPUT'
            ? 'The generated draft dates exclude a destination date.'
            : 'A destination date falls outside the trip dates.',
          errorCode,
        );
      }
    }
  }
}
