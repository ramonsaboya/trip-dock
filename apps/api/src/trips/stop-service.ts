import { eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { requireTrip } from '../data.js';
import type { AppDatabase } from '../db/client.js';
import { tripStops } from '../db/schema.js';
import { AppError, parseInput as parse, validateDateRange } from '../domain.js';
import { idSchema, revisionSchema, stopInputSchema } from './inputs.js';
import { orderStopsByDate } from './policy.js';
import { finishManualMutation, lockTrip, orderedTripStops, persistStopChronology, resequenceTripStops } from './transactions.js';

export function createStopService(db: AppDatabase) {
  return {
    async addTripStop(args: { tripId: string; expectedRevision: number; input: unknown; moveTripEnd?: boolean }) {
      const tripId = parse(idSchema, args.tripId);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(stopInputSchema, args.input);
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId, expectedRevision);
        const currentStops = await orderedTripStops(tx, tripId);
        const previous = currentStops.at(-1);
        const canMoveLinkedTripEnd = Boolean(
          args.moveTripEnd === true &&
          previous &&
          previous.departureDate === trip.endDate &&
          input.departureDate === trip.endDate,
        );
        const stop = {
          ...input,
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
        };
        validateDateRange(stop.arrivalDate, stop.departureDate, 'destination date range');
        const [positionRow] = await tx
          .select({ value: max(tripStops.position) })
          .from(tripStops)
          .where(eq(tripStops.tripId, tripId));
        const [inserted] = await tx
          .insert(tripStops)
          .values({
            tripId,
            position: (positionRow?.value ?? -1) + 1,
            ...stop,
          })
          .returning();
        if (!inserted) throw new Error('Destination insert did not return a row.');
        let ordered = await orderedTripStops(tx, tripId);
        const movesLinkedTripEnd = Boolean(
          canMoveLinkedTripEnd &&
          previous &&
          ordered.at(-1)?.id === inserted.id,
        );
        if (movesLinkedTripEnd && previous) {
          await tx
            .update(tripStops)
            .set({ departureDate: null, updatedAt: new Date().toISOString() })
            .where(eq(tripStops.id, previous.id));
          ordered = await orderedTripStops(tx, tripId);
        }
        const startDate = ordered[0]?.id === inserted.id && inserted.arrivalDate
          ? inserted.arrivalDate
          : trip.startDate;
        const endDate = ordered.at(-1)?.id === inserted.id && inserted.departureDate
          ? inserted.departureDate
          : trip.endDate;
        await persistStopChronology(tx, trip, startDate, endDate);
        await finishManualMutation(tx, tripId, trip.revision);
        return requireTrip(tx, tripId);
      });
    },
    async updateTripStop(args: { id: string; expectedRevision: number; input: unknown }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(stopInputSchema, args.input);
      validateDateRange(input.arrivalDate, input.departureDate, 'stop date range');
      const [stop] = await db.select().from(tripStops).where(eq(tripStops.id, id)).limit(1);
      if (!stop) throw new AppError('Stop not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, stop.tripId, expectedRevision);
        const before = await orderedTripStops(tx, stop.tripId);
        const existing = before.find((item) => item.id === id);
        if (!existing) throw new AppError('Stop not found.', 'NOT_FOUND');
        const existingIndex = before.findIndex((item) => item.id === id);
        const linkedNext = before[existingIndex + 1];
        const previousFirst = before[0]!;
        const previousLast = before.at(-1)!;
        const changedArrival = input.arrivalDate !== existing.arrivalDate;
        const changedDeparture = input.departureDate !== existing.departureDate;
        const updatesLinkedNext = Boolean(
          changedDeparture &&
          linkedNext &&
          linkedNext.arrivalDate === existing.departureDate,
        );
        if (updatesLinkedNext && linkedNext) {
          validateDateRange(input.departureDate, linkedNext.departureDate, 'destination date range');
        }
        await tx.update(tripStops).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(tripStops.id, id));
        if (updatesLinkedNext && linkedNext) {
          await tx
            .update(tripStops)
            .set({ arrivalDate: input.departureDate, updatedAt: new Date().toISOString() })
            .where(eq(tripStops.id, linkedNext.id));
        }
        const after = await orderedTripStops(tx, stop.tripId);
        const nextFirst = after[0]!;
        const nextLast = after.at(-1)!;
        let startDate = trip.startDate;
        let endDate = trip.endDate;
        if (changedArrival && input.arrivalDate && nextFirst.id === id) {
          startDate = input.arrivalDate;
        } else if (
          previousFirst.id === id &&
          previousFirst.arrivalDate === trip.startDate &&
          nextFirst.id !== id &&
          nextFirst.arrivalDate
        ) {
          startDate = nextFirst.arrivalDate;
        }
        if (changedDeparture && input.departureDate && nextLast.id === id) {
          endDate = input.departureDate;
        } else if (
          previousLast.id === id &&
          previousLast.departureDate === trip.endDate &&
          nextLast.id !== id &&
          nextLast.departureDate
        ) {
          endDate = nextLast.departureDate;
        }
        await persistStopChronology(tx, trip, startDate, endDate);
        await finishManualMutation(tx, stop.tripId, trip.revision);
        return requireTrip(tx, stop.tripId);
      });
    },
    async removeTripStop(args: { id: string; expectedRevision: number }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const [stop] = await db.select().from(tripStops).where(eq(tripStops.id, id)).limit(1);
      if (!stop) throw new AppError('Stop not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, stop.tripId, expectedRevision);
        const before = await orderedTripStops(tx, stop.tripId);
        if (before.length <= 1) {
          throw new AppError('A trip must keep at least one stop.', 'BAD_USER_INPUT');
        }
        const previousFirst = before[0]!;
        const previousLast = before.at(-1)!;
        await tx.delete(tripStops).where(eq(tripStops.id, id));
        const after = await orderedTripStops(tx, stop.tripId);
        const nextFirst = after[0]!;
        const nextLast = after.at(-1)!;
        const removedLinkedEnd = previousLast.id === id && previousLast.departureDate === trip.endDate;
        const startDate = previousFirst.id === id &&
          previousFirst.arrivalDate === trip.startDate &&
          nextFirst.arrivalDate
          ? nextFirst.arrivalDate
          : trip.startDate;
        const endDate = removedLinkedEnd &&
          nextLast.departureDate
          ? nextLast.departureDate
          : trip.endDate;
        await persistStopChronology(tx, trip, startDate, endDate);
        await finishManualMutation(tx, stop.tripId, trip.revision);
        return requireTrip(tx, stop.tripId);
      });
    },
    async reorderTripStops(args: { tripId: string; expectedRevision: number; stopIds: string[] }) {
      const tripId = parse(idSchema, args.tripId);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const stopIds = parse(z.array(idSchema).min(1).max(20), args.stopIds);
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId, expectedRevision);
        const current = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
        if (
          new Set(stopIds).size !== stopIds.length ||
          stopIds.length !== current.length ||
          current.some(({ id }) => !stopIds.includes(id))
        ) {
          throw new AppError('The new order must contain every stop exactly once.', 'BAD_USER_INPUT');
        }
        await resequenceTripStops(tx, tripId, orderStopsByDate(current));
        await finishManualMutation(tx, tripId, trip.revision);
        return requireTrip(tx, tripId);
      });
    }
  };
}
