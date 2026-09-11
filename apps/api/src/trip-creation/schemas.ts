import { z } from 'zod';

import { isoDateSchema } from '../domain.js';

export const tripCreationRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(8_000),
    locale: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .refine((value) => {
        try {
          new Intl.Locale(value);
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid BCP-47 locale, such as en-GB or en-US.'),
    timeZone: z
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
      }, 'Use a valid IANA timezone, such as Europe/London.'),
    referenceDate: isoDateSchema,
  })
  .strict();

export type TripCreationRequest = z.infer<typeof tripCreationRequestSchema>;

export const dateIntentSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(160).nullable(),
    kind: z.enum([
      'CALENDAR_DATE',
      'NUMERIC_DATE',
      'TODAY',
      'TOMORROW',
      'THIS_FRIDAY',
      'NEXT_WEEKEND',
      'MONTH_ONLY',
      'UNRESOLVED',
      'MISSING',
    ]),
    day: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    year: z.number().int().min(1_000).max(9_999).nullable(),
  })
  .strict();

const extractedValueOriginSchema = z.enum([
  'USER_EXPLICIT',
  'DETERMINISTIC',
  'AI_SUGGESTED',
  'MISSING',
]);

const extractedTextSchema = z
  .object({
    value: z.string().trim().min(1).max(160).nullable(),
    evidence: z.string().trim().min(1).max(240).nullable(),
    origin: extractedValueOriginSchema,
  })
  .strict();

const extractedCountSchema = z
  .object({
    value: z.number().int().min(1).max(20).nullable(),
    evidence: z.string().trim().min(1).max(240).nullable(),
    origin: extractedValueOriginSchema,
  })
  .strict();

const durationIntentSchema = z
  .object({
    value: z.number().int().min(1).max(366).nullable(),
    unit: z.enum(['DAYS', 'FULL_DAYS', 'NIGHTS', 'WEEKS', 'MISSING']),
    evidence: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

const cityCandidateSchema = z
  .object({
    city: z.string().trim().min(1).max(120),
    context: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export const destinationIntentSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(240).nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    context: z.string().trim().min(1).max(160).nullable(),
    localityKind: z.enum(['CITY', 'COUNTRY', 'REGION', 'PREFERENCE', 'AMBIGUOUS', 'UNKNOWN']),
    origin: extractedValueOriginSchema,
    candidates: z.array(cityCandidateSchema).max(4),
    arrivalDate: dateIntentSchema,
    departureDate: dateIntentSchema,
    stayDuration: durationIntentSchema,
  })
  .strict();

export const tripIntentExtractionSchema = z
  .object({
    name: extractedTextSchema,
    destinationArea: extractedTextSchema,
    travelerCount: extractedCountSchema,
    startDate: dateIntentSchema,
    endDate: dateIntentSchema,
    duration: durationIntentSchema,
    destinations: z.array(destinationIntentSchema).max(20),
    assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
    warnings: z.array(z.string().trim().min(1).max(240)).max(12),
  })
  .strict();

export type DateIntent = z.infer<typeof dateIntentSchema>;
export type DestinationIntent = z.infer<typeof destinationIntentSchema>;
export type TripIntentExtraction = z.infer<typeof tripIntentExtractionSchema>;

export const tripDraftFieldStatusSchema = z.enum([
  'EXPLICIT',
  'INTERPRETED',
  'SUGGESTED',
  'CONFIRMED',
  'MISSING',
  'NEEDS_ATTENTION',
  'INVALID',
  'CONFLICTING',
  'PAST',
]);

export const tripDraftFieldStateSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    status: tripDraftFieldStatusSchema,
    evidence: z.string().trim().min(1).max(240).nullable(),
    message: z.string().trim().min(1).max(300).nullable(),
    blocking: z.boolean(),
  })
  .strict();

export const tripClarificationUpdateSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    value: z.string().max(240).nullable(),
  })
  .strict();

export const tripClarificationOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(240),
    updates: z.array(tripClarificationUpdateSchema).min(1).max(8),
  })
  .strict();

export const tripClarificationQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    fieldPaths: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
    prompt: z.string().trim().min(1).max(300),
    options: z.array(tripClarificationOptionSchema).max(6),
    allowFreeText: z.boolean(),
    blocking: z.boolean(),
  })
  .strict();

export const tripCreationDraftStopSchema = z
  .object({
    draftId: z.string().trim().min(1).max(100),
    name: z.string().trim().max(120),
    locationText: z.string().trim().min(1).max(240).nullable(),
    arrivalDate: isoDateSchema.nullable(),
    departureDate: isoDateSchema.nullable(),
    localityKind: z.enum(['CITY', 'COUNTRY', 'REGION', 'PREFERENCE', 'AMBIGUOUS', 'UNKNOWN']),
    cityResolution: z.enum(['RESOLVED', 'SUGGESTED', 'AMBIGUOUS', 'UNRESOLVED']),
  })
  .strict();

export const tripCreationDraftSchema = z
  .object({
    name: z.string().trim().max(160),
    destinationArea: z.string().trim().max(200),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    travelerCount: z.number().int().min(1).max(20).nullable(),
    stops: z.array(tripCreationDraftStopSchema).min(1).max(20),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(20),
    warnings: z.array(z.string().trim().min(1).max(300)).max(20),
    fieldStates: z.array(tripDraftFieldStateSchema).max(100),
    questions: z.array(tripClarificationQuestionSchema).max(12),
    minimumViable: z.boolean(),
    referenceDate: isoDateSchema,
    locale: z.string().trim().min(2).max(35),
    timeZone: z.string().trim().min(1).max(80),
  })
  .strict();

export type TripCreationDraft = z.infer<typeof tripCreationDraftSchema>;
export type TripDraftFieldState = z.infer<typeof tripDraftFieldStateSchema>;
export type TripClarificationQuestion = z.infer<typeof tripClarificationQuestionSchema>;
