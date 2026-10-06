import { eq } from 'drizzle-orm';
import { requireTrip } from '../data.js';
import type { AppDatabase } from '../db/client.js';
import { activities, trips, tripStops } from '../db/schema.js';
import { AppError, parseInput as parse, validateDateRange } from '../domain.js';
import { createTripInputSchema, idSchema, revisionSchema, updateTripInputSchema } from './inputs.js';
import { orderStopsByDate, validateStopsWithinTrip } from './policy.js';
import { finishManualMutation, lockTrip, orderedTripStops, resequenceTripStops, synchronizeStopsFromTripDates } from './transactions.js';

export function createTripService(db: AppDatabase) {
  return {
    async createTrip(args: { input: unknown }) {
      const input = parse(createTripInputSchema, args.input);
      if (input.stops.some((stop) => !stop.arrivalDate || !stop.departureDate)) {
        throw new AppError('Provide arrival and departure dates for every destination.', 'BAD_USER_INPUT');
      }
      const enteredStops = input.stops.map((stop, position) => ({ ...stop, position }));
      const chronologicallyOrdered = orderStopsByDate(enteredStops);
      const startDate = input.startDate ?? chronologicallyOrdered[0]?.arrivalDate;
      const endDate = input.endDate ?? chronologicallyOrdered.at(-1)?.departureDate;
      if (!startDate) {
        throw new AppError(
          'Provide either a trip start date or an arrival date for the first destination.',
          'BAD_USER_INPUT',
        );
      }
      if (!endDate) {
        throw new AppError(
          'Provide either a trip end date or a departure date for the last destination.',
          'BAD_USER_INPUT',
        );
      }
      const preparedStops = chronologicallyOrdered.map((stop, position) => ({ ...stop, position }));
      validateStopsWithinTrip(preparedStops, startDate, endDate);
      return db.transaction(async (tx) => {
        const [trip] = await tx
          .insert(trips)
          .values({
            name: input.name,
            destinationArea: input.destinationArea,
            startDate,
            endDate,
            travelerCount: input.travelerCount,
          })
          .returning({ id: trips.id });
        if (!trip) throw new Error('Trip insert did not return an identifier.');
        await tx.insert(tripStops).values(
          preparedStops.map(({ position, ...stop }) => ({
            tripId: trip.id,
            position,
            ...stop,
          })),
        );
        return requireTrip(tx, trip.id);
      });
    },
    async updateTrip(args: { id: string; expectedRevision: number; input: unknown }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(updateTripInputSchema, args.input);
      const { stops: stopDates, newStops = [], ...tripInput } = input;
      validateDateRange(input.startDate, input.endDate, 'trip date range');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, id, expectedRevision);
        const previousStops = await orderedTripStops(tx, id);
        if (previousStops.length + newStops.length > 20) {
          throw new AppError('A trip can have at most 20 destinations.', 'BAD_USER_INPUT');
        }
        if (stopDates) {
          if (new Set(stopDates.map(stop => stop.id)).size !== stopDates.length || stopDates.length !== previousStops.length || previousStops.some(stop => !stopDates.some(value => value.id === stop.id))) {
            throw new AppError('Include every destination in this trip exactly once.', 'BAD_USER_INPUT');
          }
          const updatedStops = previousStops.map(stop => ({ ...stop, ...stopDates.find(value => value.id === stop.id)! }));
          validateStopsWithinTrip(updatedStops, input.startDate, input.endDate);
          for (const stop of updatedStops) {
            const previous = previousStops.find(value => value.id === stop.id)!;
            if (previous.arrivalDate !== stop.arrivalDate || previous.departureDate !== stop.departureDate) {
              await tx.update(tripStops).set({ arrivalDate: stop.arrivalDate, departureDate: stop.departureDate, updatedAt: new Date().toISOString() }).where(eq(tripStops.id, stop.id));
            }
          }
          await resequenceTripStops(tx, id, orderStopsByDate(updatedStops));
        } else {
          await synchronizeStopsFromTripDates(tx, trip, input.startDate, input.endDate);
        }
        if (newStops.length) {
          const currentStops = await orderedTripStops(tx, id);
          const nextPosition = Math.max(...currentStops.map(stop => stop.position)) + 1;
          validateStopsWithinTrip(newStops.map((stop, index) => ({ ...stop, position: nextPosition + index })), input.startDate, input.endDate);
          await tx.insert(tripStops).values(newStops.map((stop, index) => ({ ...stop, tripId: id, position: nextPosition + index })));
          await resequenceTripStops(tx, id, await orderedTripStops(tx, id));
        }
        const destinationsChanged = stopDates?.some(stop => {
          const previous = previousStops.find(value => value.id === stop.id)!;
          return previous.arrivalDate !== stop.arrivalDate || previous.departureDate !== stop.departureDate;
        });
        if (newStops.length || destinationsChanged || trip.startDate !== input.startDate || trip.endDate !== input.endDate) {
          const stops = await orderedTripStops(tx, id);
          const scheduled = await tx.select().from(activities).where(eq(activities.tripId, id));
          for (const activity of scheduled) {
            if (!activity.scheduledAt) continue;
            const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: activity.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
            const firstDay = localDate.format(new Date(activity.scheduledAt));
            // The interval is half-open: finishing exactly at midnight still fits the previous day.
            const lastDay = localDate.format(new Date(new Date(activity.scheduledAt).getTime() + activity.durationMinutes * 60_000 - 1));
            const stop = stops.find(value => value.id === activity.stopId)!;
            if (firstDay < input.startDate || lastDay > input.endDate || (stop.arrivalDate && firstDay < stop.arrivalDate) || (stop.departureDate && lastDay > stop.departureDate)) {
              await tx.update(activities).set({ scheduledAt: null, updatedAt: new Date().toISOString() }).where(eq(activities.id, activity.id));
            }
          }
        }
        await tx.update(trips).set({ ...tripInput, updatedAt: new Date().toISOString() }).where(eq(trips.id, id));
        await finishManualMutation(tx, id, trip.revision);
        return requireTrip(tx, id);
      });
    },
    async deleteTrip(args: { id: string; expectedRevision: number }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      await db.transaction(async (tx) => {
        await lockTrip(tx, id, expectedRevision);
        await tx.delete(trips).where(eq(trips.id, id));
      });
      return true;
    }
  };
}
