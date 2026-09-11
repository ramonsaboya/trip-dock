import { eq } from 'drizzle-orm';
import { requireTrip } from '../data.js';
import type { AppDatabase } from '../db/client.js';
import { trips, tripStops } from '../db/schema.js';
import { AppError, parseInput as parse, validateDateRange } from '../domain.js';
import { createTripInputSchema, idSchema, revisionSchema, updateTripInputSchema } from './inputs.js';
import { orderStopsByDate, validateStopsWithinTrip } from './policy.js';
import { finishManualMutation, lockTrip, synchronizeStopsFromTripDates } from './transactions.js';

export function createTripService(db: AppDatabase) {
  return {
    async createTrip(args: { input: unknown }) {
      const input = parse(createTripInputSchema, args.input);
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
      validateDateRange(input.startDate, input.endDate, 'trip date range');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, id, expectedRevision);
        await synchronizeStopsFromTripDates(tx, trip, input.startDate, input.endDate);
        await tx.update(trips).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(trips.id, id));
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
