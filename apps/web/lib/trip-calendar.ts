import { isoToDateTimeLocal, sortStopsByDate, type Stay, type TransportLeg, type Trip, type TripStop } from './graphql-client.ts';
import { destinationDays } from './activity-planning.ts';

export function calendarColumns(trip: Trip) {
  const stops = sortStopsByDate(trip.stops);
  return destinationDays({ arrivalDate: trip.startDate, departureDate: trip.endDate }).map((day) => {
    const destinations = stops.filter((stop) => stop.arrivalDate && stop.departureDate && day >= stop.arrivalDate && day <= stop.departureDate);
    // On a transfer date the arriving destination owns the column; activities
    // from either destination still appear once, under their actual local date.
    const destination = destinations.at(-1);
    return { day, destination, destinations, color: destination ? stops.findIndex((stop) => stop.id === destination.id) % 5 : -1 };
  });
}

export function transportPlacement(leg: TransportLeg, stops: TripStop[]) {
  const local = isoToDateTimeLocal(leg.departureTime ?? leg.arrivalTime, leg.timezone);
  if (local) return { day: local.slice(0, 10), hour: local.slice(11, 13) + ':00', suggested: false };
  const from = stops.find((stop) => stop.id === leg.fromStopId);
  const to = stops.find((stop) => stop.id === leg.toStopId);
  return { day: from?.departureDate ?? to?.arrivalDate ?? null, hour: null, suggested: true };
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
    { fromStopId: null, toStopId: stops[0]!.id, day: stops[0]!.arrivalDate, label: 'Getting there' },
    ...stops.map((stop, index) => ({ fromStopId: stop.id, toStopId: stops[index + 1]?.id ?? null, day: stop.departureDate, label: stops[index + 1] ? `${stop.name} → ${stops[index + 1]!.name}` : 'Getting home' })),
  ];
}
