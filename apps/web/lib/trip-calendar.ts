import { isoToDateTimeLocal, sortStopsByDate, type Stay, type TransportLeg, type Trip, type TripStop } from './graphql-client.ts';
import { activityAssignment, destinationDays } from './activity-planning.ts';

export function calendarColumns(trip: Trip) {
  const stops = sortStopsByDate(trip.stops);
  return destinationDays({ arrivalDate: trip.startDate, departureDate: trip.endDate }).map((day) => {
    const destinations = stops.filter((stop) => stop.arrivalDate && stop.departureDate && day >= stop.arrivalDate && day <= stop.departureDate);
    const destination = destinations.length === 1 ? destinations[0] : undefined;
    const colors = destinations.map((item) => stops.findIndex((stop) => stop.id === item.id) % 5);
    return { day, destination, destinations, colors, color: destinations.length > 1 ? -2 : colors[0] ?? -1 };
  });
}

export function transportPlacement(leg: TransportLeg, stops: TripStop[]) {
  const local = isoToDateTimeLocal(leg.departureTime ?? leg.arrivalTime, leg.timezone);
  if (local) return { day: local.slice(0, 10), hour: local.slice(11, 13) + ':00', suggested: false };
  const from = stops.find((stop) => stop.id === leg.fromStopId);
  const to = stops.find((stop) => stop.id === leg.toStopId);
  return { day: from?.departureDate ?? to?.arrivalDate ?? null, hour: '10:00', suggested: true };
}

export function stayCoversDay(stay: Stay, day: string, stops: TripStop[]) {
  const stop = stops.find((item) => item.id === stay.stopId);
  const start = isoToDateTimeLocal(stay.checkIn, stay.timezone)?.slice(0, 10) ?? stop?.arrivalDate;
  const end = isoToDateTimeLocal(stay.checkOut, stay.timezone)?.slice(0, 10) ?? stop?.departureDate;
  return Boolean(start && end && day >= start && (start === end ? day === end : day < end));
}

export function tripRoutes(trip: Trip) {
  const stops = sortStopsByDate(trip.stops);
  if (!stops.length) return [];
  return [
    { fromStopId: null, toStopId: stops[0]!.id, day: stops[0]!.arrivalDate ?? trip.startDate, label: 'Getting there' },
    ...stops.map((stop, index) => ({ fromStopId: stop.id, toStopId: stops[index + 1]?.id ?? null, day: stop.departureDate ?? stops[index + 1]?.arrivalDate ?? (index === stops.length - 1 ? trip.endDate : null), label: stops[index + 1] ? `${stop.name} → ${stops[index + 1]!.name}` : 'Getting home' })),
  ];
}


export function calendarStartHour(trip: Trip, days: string[]) {
  const visible = new Set(days);
  const hours = [9];
  for (const activity of trip.activities) {
    const placement = activityAssignment(activity);
    if (placement && visible.has(placement.day)) hours.push(Number(placement.hour.slice(0, 2)));
  }
  for (const leg of trip.transportLegs) {
    const placement = transportPlacement(leg, trip.stops);
    if (placement.day && !placement.suggested && visible.has(placement.day)) hours.push(Number(placement.hour.slice(0, 2)));
  }
  return String(Math.min(...hours)).padStart(2, '0') + ':00';
}

export function calendarStayBands(trip: Trip, columns: ReturnType<typeof calendarColumns>) {
  const bands: Array<{ key: string; span: number; stays: Stay[]; destinations: TripStop[] }> = [];
  for (const column of columns) {
    const stays = trip.stays.filter((stay) => stayCoversDay(stay, column.day, trip.stops));
    const section = column.destinations.at(-1);
    const key = (section?.id ?? 'open') + ':' + (stays.length ? stays.map((stay) => stay.id).sort().join('|') : 'empty');
    const previous = bands.at(-1);
    if (previous?.key === key) {
      previous.span += 1;
    } else bands.push({ key, span: 1, stays, destinations: section ? [section] : [] });
  }
  return bands;
}

// Color follows the journey down the day's hours, never diagonally across a day.
// This is presentation only: placeholders do not create booking timestamps.
export function calendarHourDestination(trip: Trip, day: string, hour: string): TripStop | undefined {
  const stops = sortStopsByDate(trip.stops);
  const present = stops.filter((stop) => stop.arrivalDate && stop.departureDate && day >= stop.arrivalDate && day <= stop.departureDate);
  const transitions = tripRoutes(trip).flatMap((route) => {
    const legs = trip.transportLegs.filter((leg) => leg.fromStopId === route.fromStopId && leg.toStopId === route.toStopId);
    if (!legs.length) return route.day === day ? [{ start: 10, end: 11, from: route.fromStopId, to: route.toStopId }] : [];
    return legs.flatMap((leg) => {
      const place = transportPlacement(leg, stops);
      if (place.day !== day) return [];
      const start = Number(place.hour.slice(0, 2));
      const arrival = isoToDateTimeLocal(leg.arrivalTime, leg.timezone);
      const end = arrival && arrival.slice(0, 10) === day
        ? Math.max(start + 1, Number(arrival.slice(11, 13)) + (arrival.slice(14, 16) === '00' ? 0 : 1))
        : arrival && arrival.slice(0, 10) > day ? 24 : start + 1;
      return [{ start, end, from: route.fromStopId, to: route.toStopId }];
    });
  }).sort((a, b) => a.start - b.start);
  if (!transitions.length) return present.at(-1);
  const time = Number(hour.slice(0, 2));
  if (transitions.some((transition) => time >= transition.start && time < transition.end)) return undefined;
  const preceding = transitions.filter((transition) => transition.end <= time).at(-1);
  const id = preceding ? preceding.to : transitions[0]!.from;
  return stops.find((stop) => stop.id === id);
}
