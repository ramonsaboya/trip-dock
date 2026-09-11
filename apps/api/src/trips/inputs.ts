import { z } from 'zod';
import { activityStatusSchema, AppError, isoDateSchema, isoDateTimeSchema, timezoneSchema, tripDraftStopSchema } from '../domain.js';

const requiredText = z.string().trim().min(1).max(240);
const nullableText = z.string().trim().min(1).max(500).nullable();
export const revisionSchema = z.number().int().min(0);
export const idSchema = z.string().uuid();

export const createTripInputSchema = z
  .object({
    name: requiredText.max(160),
    destinationArea: requiredText.max(200),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    travelerCount: z.number().int().min(1).max(20).nullish().transform((value) => value ?? null),
    stops: z.array(tripDraftStopSchema).min(1).max(20),
  })
  .strict();

export const updateTripInputSchema = z
  .object({
    name: requiredText.max(160),
    destinationArea: requiredText.max(200),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    travelerCount: z.number().int().min(1).max(20).nullish().transform((value) => value ?? null),
  })
  .strict();
export const stopInputSchema = tripDraftStopSchema;
export const transportInputSchema = z
  .object({
    fromStopId: idSchema.nullish().transform((value) => value ?? null),
    toStopId: idSchema.nullish().transform((value) => value ?? null),
    fromLocation: nullableText.optional().transform((value) => value ?? null),
    toLocation: nullableText.optional().transform((value) => value ?? null),
    mode: requiredText.max(60),
    title: requiredText.max(200),
    details: nullableText,
    departureTime: isoDateTimeSchema.nullable(),
    arrivalTime: isoDateTimeSchema.nullable(),
    timezone: timezoneSchema,
  })
  .strict();
export function validateTransportEndpoints(input: z.infer<typeof transportInputSchema>) {
  if ((!input.fromStopId && !input.toStopId) ||
    Boolean(input.fromStopId) === Boolean(input.fromLocation) ||
    Boolean(input.toStopId) === Boolean(input.toLocation)) {
    throw new AppError('Choose a destination or enter an external location for each endpoint. At least one endpoint must be a trip destination.', 'BAD_USER_INPUT');
  }
}
export const stayInputSchema = z
  .object({
    stopId: idSchema,
    name: requiredText.max(200),
    checkIn: isoDateTimeSchema.nullable(),
    checkOut: isoDateTimeSchema.nullable(),
    timezone: timezoneSchema,
  })
  .strict();
export const activityInputSchema = z
  .object({
    stopId: idSchema,
    title: requiredText.max(200),
    status: activityStatusSchema,
    scheduledAt: isoDateTimeSchema.nullable(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    timezone: timezoneSchema,
  })
  .strict();
