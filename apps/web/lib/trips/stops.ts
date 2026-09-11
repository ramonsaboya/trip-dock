import { type TripInput, type TripStop } from './types.ts';

export function updateTripBoundaryDate(
  input: TripInput,
  boundary: 'start' | 'end',
  date: string,
  options: { stopDateDirty?: boolean } = {},
): TripInput {
  const dateKey = boundary === 'start' ? 'startDate' : 'endDate';
  const stopKey = boundary === 'start' ? 'arrivalDate' : 'departureDate';
  const stopIndex = boundary === 'start' ? 0 : input.stops.length - 1;
  const previousDate = input[dateKey];
  return {
    ...input,
    [dateKey]: date,
    stops: input.stops.map((stop, index) =>
      index === stopIndex &&
      !options.stopDateDirty &&
      (!stop[stopKey] || stop[stopKey] === previousDate)
        ? { ...stop, [stopKey]: date || null }
        : stop,
    ),
  };
}

export function updateTripStopDate(
  input: TripInput,
  index: number,
  field: 'arrivalDate' | 'departureDate',
  date: string | null,
  options: { nextArrivalDirty?: boolean; tripBoundaryDirty?: boolean } = {},
): TripInput {
  const previousDate = input.stops[index]?.[field] ?? null;
  const next: TripInput = {
    ...input,
    stops: input.stops.map((stop, stopIndex) =>
      stopIndex === index
        ? { ...stop, [field]: date }
        : field === 'departureDate' &&
            stopIndex === index + 1 &&
            !options.nextArrivalDirty &&
            (!stop.arrivalDate || stop.arrivalDate === previousDate)
          ? { ...stop, arrivalDate: date }
          : stop,
    ),
  };
  if (index === 0 && field === 'arrivalDate' && date && !options.tripBoundaryDirty) {
    next.startDate = date;
  }
  if (
    index === input.stops.length - 1 &&
    field === 'departureDate' &&
    date &&
    !options.tripBoundaryDirty
  ) {
    next.endDate = date;
  }
  return next;
}

export function appendTripStop(
  input: TripInput,
  options: { lastDepartureDirty?: boolean } = {},
): TripInput {
  const previous = input.stops.at(-1);
  const movesLinkedTripEnd = Boolean(
    previous &&
    input.endDate &&
    !options.lastDepartureDirty &&
    previous.departureDate === input.endDate,
  );
  return {
    ...input,
    stops: [
      ...input.stops.map((stop, index) =>
        movesLinkedTripEnd && index === input.stops.length - 1
          ? { ...stop, departureDate: null }
          : stop,
      ),
      {
        name: '',
        locationText: null,
        arrivalDate: movesLinkedTripEnd ? null : previous?.departureDate ?? null,
        departureDate: input.endDate || null,
      },
    ],
  };
}

export function removeTripStop(
  input: TripInput,
  index: number,
  options: { preserveTripEnd?: boolean; survivingDepartureDirty?: boolean } = {},
): TripInput {
  const removed = input.stops[index];
  let stops = input.stops.filter((_, stopIndex) => stopIndex !== index);
  const removedLinkedStart = index === 0 && removed?.arrivalDate === input.startDate;
  const removedLinkedEnd = index === input.stops.length - 1 && removed?.departureDate === input.endDate;
  if (
    removedLinkedEnd &&
    stops.length &&
    !options.survivingDepartureDirty &&
    !stops.at(-1)?.departureDate
  ) {
    stops = stops.map((stop, stopIndex) =>
      stopIndex === stops.length - 1 ? { ...stop, departureDate: input.endDate || null } : stop,
    );
  }
  return {
    ...input,
    stops,
    startDate: removedLinkedStart ? stops[0]?.arrivalDate ?? input.startDate : input.startDate,
    endDate: removedLinkedEnd && !options.preserveTripEnd
      ? stops.at(-1)?.departureDate ?? input.endDate
      : input.endDate,
  };
}

export function destinationAreaFromStops(
  input: Pick<TripInput, 'destinationArea' | 'name' | 'stops'>,
): string {
  const names = input.stops.map((stop) => stop.name.trim()).filter(Boolean);
  return (
    input.destinationArea.trim() ||
    names.join(' · ') ||
    input.name.trim() ||
    'Trip'
  ).slice(0, 200);
}

export function sortStopsByDate<T extends Pick<TripStop, 'arrivalDate' | 'departureDate' | 'position'>>(
  stops: readonly T[],
): T[] {
  return [...stops].sort((left, right) => {
    const leftDate = left.arrivalDate ?? left.departureDate;
    const rightDate = right.arrivalDate ?? right.departureDate;
    if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (leftDate && !rightDate) return -1;
    if (!leftDate && rightDate) return 1;
    const leftEnd = left.departureDate ?? left.arrivalDate;
    const rightEnd = right.departureDate ?? right.arrivalDate;
    if (leftEnd && rightEnd && leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd);
    if (leftEnd && !rightEnd) return -1;
    if (!leftEnd && rightEnd) return 1;
    return left.position - right.position;
  });
}
