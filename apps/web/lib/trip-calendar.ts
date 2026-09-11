import { activityAssignment, destinationDays } from './activity-planning.ts';
import { dateTimeLocalToIso, isoToDateTimeLocal } from './trips/dates.ts';
import { sortStopsByDate } from './trips/stops.ts';
import { type Activity, type Stay, type TransportLeg, type Trip, type TripStop } from './trips/types.ts';

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
    const sections = column.destinations.length > 1 ? [column.destinations[0], column.destinations.at(-1)] : [column.destinations[0]];
    sections.forEach((section, index) => {
      const stays = trip.stays.filter((stay) => {
        if (stay.stopId !== section?.id) return false;
        const checkout = isoToDateTimeLocal(stay.checkOut, stay.timezone)?.slice(0, 10) ?? section?.departureDate;
        return stayCoversDay(stay, column.day, trip.stops) || (sections.length === 2 && index === 0 && checkout === column.day);
      });
      const key = (section?.id ?? 'open') + ':' + (stays.length ? stays.map((stay) => stay.id).sort().join('|') : 'empty');
      const span = 2 / sections.length;
      const previous = bands.at(-1);
      if (previous?.key === key) previous.span += span;
      else bands.push({ key, span, stays, destinations: section ? [section] : [] });
    });
  }
  return bands;
}

// Hourly destination paper follows local transport times.
// This is presentation only: placeholders do not create booking timestamps.
type Transition = { start: number; end: number; from: string | null; to: string | null };
function transitionsByDay(trip: Trip, stops: TripStop[]) {
  const result = new Map<string, Transition[]>();
  const legsByRoute = indexRouteLegs(trip.transportLegs);
  for (const route of tripRoutes(trip)) {
    const legs = legsByRoute.get(routeKey(route)) ?? [];
    if (!legs.length && route.day) append(result, route.day, { start: 10, end: 12, from: route.fromStopId, to: route.toStopId });
    for (const leg of legs) {
      const place = transportPlacement(leg, stops);
      if (!place.day) continue;
      const start = timeMinutes(transportLocalTime(leg)) / 60;
      const arrival = isoToDateTimeLocal(leg.arrivalTime, leg.timezone);
      const end = arrival && arrival.slice(0, 10) === place.day
        ? Math.max(start + .5, timeMinutes(arrival.slice(11, 16)) / 60)
        : arrival && arrival.slice(0, 10) > place.day ? 24 : start + (place.suggested ? 2 : 1);
      append(result, place.day, { start, end, from: route.fromStopId, to: route.toStopId });
    }
  }
  for (const transitions of result.values()) transitions.sort((a, b) => a.start - b.start);
  return result;
}

export function routeKey(route: { fromStopId: string | null; toStopId: string | null }) {
  return JSON.stringify([route.fromStopId, route.toStopId]);
}

function indexRouteLegs(legs: TransportLeg[]) {
  const result = new Map<string, TransportLeg[]>();
  for (const leg of legs) append(result, routeKey(leg), leg);
  return result;
}

function append<T>(map: Map<string, T[]>, key: string, value: T) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value); else map.set(key, [value]);
}

// Prepare once per data revision. Hour-cell rendering only performs map lookups.
export function calendarEventIndex(trip: Trip) {
  const stops = sortStopsByDate(trip.stops);
  const days = new Set(calendarColumns(trip).map(({ day }) => day));
  const activities = new Map<string, Activity[]>();
  const transport = new Map<string, TransportLeg[]>();
  const placeholders = new Map<string, ReturnType<typeof tripRoutes>>();
  const assignments = new Map(trip.activities.map((activity) => [activity.id, activityAssignment(activity)]));
  const unplacedActivities: Activity[] = [];
  const unplacedTransport: TransportLeg[] = [];
  for (const activity of trip.activities) {
    const place = assignments.get(activity.id);
    if (!place || !days.has(place.day)) unplacedActivities.push(activity);
    else append(activities, place.day + '-' + place.hour, activity);
  }
  for (const bucket of activities.values()) bucket.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') || a.position - b.position);
  for (const leg of trip.transportLegs) {
    const place = transportPlacement(leg, stops);
    if (!place.day || !days.has(place.day)) unplacedTransport.push(leg);
    else append(transport, place.day + '-' + place.hour, leg);
  }
  const legs = indexRouteLegs(trip.transportLegs);
  for (const route of tripRoutes(trip)) {
    if (route.day && !legs.has(routeKey(route))) append(placeholders, route.day, route);
  }
  return { activities, transport, placeholders, assignments, unplacedActivities, unplacedTransport };
}

// Each day's route/timezone calculations are shared by all 48 half-hour samples.
export function calendarPaperResolver(trip: Trip) {
  const stops = sortStopsByDate(trip.stops);
  const transitionsByDate = transitionsByDay(trip, stops);
  const days = new Map<string, ReturnType<typeof prepare>>();
  function prepare(day: string) {
    const transitions = transitionsByDate.get(day) ?? [];
    const present = stops.filter((stop) => stop.arrivalDate && stop.departureDate && day >= stop.arrivalDate && day <= stop.departureDate);
    return {
      transition(time: number) { return transitions.find((item) => item.from && item.to && time >= item.start && time < item.end); },
      destination(time: number): TripStop | undefined {
        if (!transitions.length) return present.at(-1);
        const active = transitions.find((item) => time >= item.start && time < item.end);
        const preceding = transitions.filter((item) => item.end <= time).at(-1);
        const id = active ? active.from ?? active.to : preceding ? preceding.to ?? preceding.from : transitions[0]!.from ?? transitions[0]!.to;
        return stops.find((stop) => stop.id === id);
      },
    };
  }
  return (day: string) => {
    let prepared = days.get(day);
    if (!prepared) { prepared = prepare(day); days.set(day, prepared); }
    return prepared;
  };
}

export function calendarTransition(trip: Trip, day: string, hour: string) {
  return calendarPaperResolver(trip)(day).transition(timeMinutes(hour) / 60);
}

export function calendarHourDestination(trip: Trip, day: string, hour: string): TripStop | undefined {
  return calendarPaperResolver(trip)(day).destination(timeMinutes(hour) / 60);
}

export function transportMoveInput(leg: TransportLeg, day: string, time: string, timezone: string) {
  const departureTime = dateTimeLocalToIso(day + 'T' + time, timezone);
  const duration = leg.departureTime && leg.arrivalTime ? new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime() : null;
  return {
    fromStopId: leg.fromStopId, toStopId: leg.toStopId, fromLocation: leg.fromLocation, toLocation: leg.toLocation,
    mode: leg.mode, title: leg.title, details: leg.details, timezone, departureTime: !leg.departureTime && leg.arrivalTime ? null : departureTime,
    arrivalTime: !leg.departureTime && leg.arrivalTime ? departureTime : duration !== null && departureTime ? new Date(new Date(departureTime).getTime() + duration).toISOString() : null,
  };
}

export const calendarHalfHours = Array.from({ length: 48 }, (_, index) => String(Math.floor(index / 2)).padStart(2, '0') + (index % 2 ? ':30' : ':00'));
export const slotHeight = 64;
export function timeMinutes(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
export function halfHourSlot(time: string) { const minutes = timeMinutes(time); return calendarHalfHours[Math.floor(minutes / 30)]!; }
export function transportLocalTime(leg: TransportLeg) { return isoToDateTimeLocal(leg.departureTime ?? leg.arrivalTime, leg.timezone)?.slice(11, 16) ?? '10:00'; }
export function dragStartMinute(target: number, duration: number, grabOffset: number) { return Math.max(0, Math.min(1440 - duration, Math.round((target - grabOffset) / 30) * 30)); }
export function resizeStart(iso: string, oldDuration: number, newDuration: number, edge: 'top' | 'bottom') { return new Date(new Date(iso).getTime() + (edge === 'top' ? oldDuration - newDuration : 0) * 60000).toISOString(); }
