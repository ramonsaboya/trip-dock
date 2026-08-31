import { z } from 'zod';

export type ErrorCode =
  | 'BAD_USER_INPUT'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'STALE_PROPOSAL'
  | 'AI_NOT_CONFIGURED'
  | 'AI_MODEL_UNSUPPORTED'
  | 'AI_REFUSAL'
  | 'AI_INCOMPLETE'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_INVALID_OUTPUT';

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Use a real calendar date.');

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO timestamp with a UTC offset.' });

export const activityStatusSchema = z.enum(['IDEA', 'PLANNED', 'BOOKED', 'DONE']);

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone, such as Europe/London.')
  .nullable();

export const tripDraftStopSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    locationText: z.string().trim().min(1).max(240).nullable(),
    arrivalDate: isoDateSchema.nullable(),
    departureDate: isoDateSchema.nullable(),
  })
  .strict();

export const tripDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    destinationArea: z.string().trim().min(1).max(200),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    travelerCount: z.number().int().min(1).max(20).nullable(),
    stops: z.array(tripDraftStopSchema).min(1).max(20),
    assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
    warnings: z.array(z.string().trim().min(1).max(240)).max(12),
  })
  .strict();

const updateTripOperationSchema = z
  .object({
    type: z.literal('UPDATE_TRIP'),
    description: z.string().trim().min(1).max(240),
    payload: z
      .object({
        name: z.string().trim().min(1).max(160),
        destinationArea: z.string().trim().min(1).max(200),
        startDate: isoDateSchema,
        endDate: isoDateSchema,
        travelerCount: z.number().int().min(1).max(20),
      })
      .strict(),
  })
  .strict();

const addActivityOperationSchema = z
  .object({
    type: z.literal('ADD_ACTIVITY'),
    description: z.string().trim().min(1).max(240),
    payload: z
      .object({
        stopId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        status: activityStatusSchema,
        scheduledAt: isoDateTimeSchema.nullable(),
        timezone: timezoneSchema,
      })
      .strict(),
  })
  .strict();

const updateActivityOperationSchema = z
  .object({
    type: z.literal('UPDATE_ACTIVITY'),
    description: z.string().trim().min(1).max(240),
    payload: z
      .object({
        activityId: z.string().uuid(),
        stopId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        status: activityStatusSchema,
        scheduledAt: isoDateTimeSchema.nullable(),
        timezone: timezoneSchema,
      })
      .strict(),
  })
  .strict();

const removeActivityOperationSchema = z
  .object({
    type: z.literal('REMOVE_ACTIVITY'),
    description: z.string().trim().min(1).max(240),
    payload: z.object({ activityId: z.string().uuid() }).strict(),
  })
  .strict();

export const proposalOperationSchema = z.discriminatedUnion('type', [
  updateTripOperationSchema,
  addActivityOperationSchema,
  updateActivityOperationSchema,
  removeActivityOperationSchema,
]);

export const proposalOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    operations: z.array(proposalOperationSchema).min(1).max(12),
  })
  .strict();

export type TripDraft = z.infer<typeof tripDraftSchema>;
export type ProposalOperation = z.infer<typeof proposalOperationSchema>;
export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

export function validateDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  label = 'date range',
): void {
  if (startDate) isoDateSchema.parse(startDate);
  if (endDate) isoDateSchema.parse(endDate);
  if (startDate && endDate && endDate < startDate) {
    throw new AppError(`The ${label} ends before it starts.`, 'BAD_USER_INPUT');
  }
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message ?? 'Invalid input.', 'BAD_USER_INPUT');
  }
  return result.data;
}
