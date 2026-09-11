import { and, eq, max } from 'drizzle-orm';
import { requireTrip } from '../data.js';
import type { AppDatabase } from '../db/client.js';
import { activities, stays, transportLegs } from '../db/schema.js';
import { AppError, parseInput as parse } from '../domain.js';
import { activityInputSchema, idSchema, revisionSchema, stayInputSchema, transportInputSchema, validateTransportEndpoints } from './inputs.js';
import { validateTimestampRange } from './policy.js';
import { assertStopsBelong, finishManualMutation, lockTrip } from './transactions.js';

export function createItineraryService(db: AppDatabase) {
  return {
    async addTransportLeg(args: { tripId: string; expectedRevision: number; input: unknown }) {
      const tripId = parse(idSchema, args.tripId);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(transportInputSchema, args.input);
      validateTransportEndpoints(input);
      if (input.fromStopId === input.toStopId) {
        throw new AppError('Transport must connect two different stops.', 'BAD_USER_INPUT');
      }
      validateTimestampRange(input.departureTime, input.arrivalTime, 'transport timing');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId, expectedRevision);
        await assertStopsBelong(tx, tripId, [input.fromStopId, input.toStopId].filter((id): id is string => id !== null));
        const [positionRow] = await tx.select({ value: max(transportLegs.position) }).from(transportLegs).where(eq(transportLegs.tripId, tripId));
        await tx.insert(transportLegs).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
        await finishManualMutation(tx, tripId, trip.revision);
        return requireTrip(tx, tripId);
      });
    },
    async updateTransportLeg(args: { id: string; expectedRevision: number; input: unknown }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(transportInputSchema, args.input);
      validateTransportEndpoints(input);
      if (input.fromStopId === input.toStopId) throw new AppError('Transport must connect two different stops.', 'BAD_USER_INPUT');
      validateTimestampRange(input.departureTime, input.arrivalTime, 'transport timing');
      const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.id, id)).limit(1);
      if (!leg) throw new AppError('Transport leg not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, leg.tripId, expectedRevision);
        await assertStopsBelong(tx, leg.tripId, [input.fromStopId, input.toStopId].filter((id): id is string => id !== null));
        await tx.update(transportLegs).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(transportLegs.id, id));
        await finishManualMutation(tx, leg.tripId, trip.revision);
        return requireTrip(tx, leg.tripId);
      });
    },
    async removeTransportLeg(args: { id: string; expectedRevision: number }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.id, id)).limit(1);
      if (!leg) throw new AppError('Transport leg not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, leg.tripId, expectedRevision);
        await tx.delete(transportLegs).where(eq(transportLegs.id, id));
        await finishManualMutation(tx, leg.tripId, trip.revision);
        return requireTrip(tx, leg.tripId);
      });
    },
    async addStay(args: { tripId: string; expectedRevision: number; input: unknown }) {
      const tripId = parse(idSchema, args.tripId);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(stayInputSchema, args.input);
      validateTimestampRange(input.checkIn, input.checkOut, 'stay');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId, expectedRevision);
        await assertStopsBelong(tx, tripId, [input.stopId]);
        const [positionRow] = await tx.select({ value: max(stays.position) }).from(stays).where(and(eq(stays.tripId, tripId), eq(stays.stopId, input.stopId)));
        await tx.insert(stays).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
        await finishManualMutation(tx, tripId, trip.revision);
        return requireTrip(tx, tripId);
      });
    },
    async updateStay(args: { id: string; expectedRevision: number; input: unknown }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(stayInputSchema, args.input);
      validateTimestampRange(input.checkIn, input.checkOut, 'stay');
      const [stay] = await db.select().from(stays).where(eq(stays.id, id)).limit(1);
      if (!stay) throw new AppError('Stay not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, stay.tripId, expectedRevision);
        await assertStopsBelong(tx, stay.tripId, [input.stopId]);
        let position = stay.position;
        if (input.stopId !== stay.stopId) {
          const [positionRow] = await tx
            .select({ value: max(stays.position) })
            .from(stays)
            .where(eq(stays.stopId, input.stopId));
          position = (positionRow?.value ?? -1) + 1;
        }
        await tx.update(stays).set({ ...input, position, updatedAt: new Date().toISOString() }).where(eq(stays.id, id));
        await finishManualMutation(tx, stay.tripId, trip.revision);
        return requireTrip(tx, stay.tripId);
      });
    },
    async removeStay(args: { id: string; expectedRevision: number }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const [stay] = await db.select().from(stays).where(eq(stays.id, id)).limit(1);
      if (!stay) throw new AppError('Stay not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, stay.tripId, expectedRevision);
        await tx.delete(stays).where(eq(stays.id, id));
        await finishManualMutation(tx, stay.tripId, trip.revision);
        return requireTrip(tx, stay.tripId);
      });
    },
    async addActivity(args: { tripId: string; expectedRevision: number; input: unknown }) {
      const tripId = parse(idSchema, args.tripId);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(activityInputSchema, args.input);
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, tripId, expectedRevision);
        await assertStopsBelong(tx, tripId, [input.stopId]);
        const [positionRow] = await tx.select({ value: max(activities.position) }).from(activities).where(and(eq(activities.tripId, tripId), eq(activities.stopId, input.stopId)));
        await tx.insert(activities).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
        await finishManualMutation(tx, tripId, trip.revision);
        return requireTrip(tx, tripId);
      });
    },
    async updateActivity(args: { id: string; expectedRevision: number; input: unknown }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const input = parse(activityInputSchema, args.input);
      const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
      if (!activity) throw new AppError('Activity not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, activity.tripId, expectedRevision);
        await assertStopsBelong(tx, activity.tripId, [input.stopId]);
        let position = activity.position;
        if (input.stopId !== activity.stopId) {
          const [positionRow] = await tx
            .select({ value: max(activities.position) })
            .from(activities)
            .where(eq(activities.stopId, input.stopId));
          position = (positionRow?.value ?? -1) + 1;
        }
        await tx.update(activities).set({ ...input, position, updatedAt: new Date().toISOString() }).where(eq(activities.id, id));
        await finishManualMutation(tx, activity.tripId, trip.revision);
        return requireTrip(tx, activity.tripId);
      });
    },
    async removeActivity(args: { id: string; expectedRevision: number }) {
      const id = parse(idSchema, args.id);
      const expectedRevision = parse(revisionSchema, args.expectedRevision);
      const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
      if (!activity) throw new AppError('Activity not found.', 'NOT_FOUND');
      return db.transaction(async (tx) => {
        const trip = await lockTrip(tx, activity.tripId, expectedRevision);
        await tx.delete(activities).where(eq(activities.id, id));
        await finishManualMutation(tx, activity.tripId, trip.revision);
        return requireTrip(tx, activity.tripId);
      });
    }
  };
}
