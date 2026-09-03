import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

import { AppError } from './domain.js';
import {
  tripIntentExtractionSchema,
  type TripCreationRequest,
  type TripIntentExtraction,
} from './trip-creation.js';

export type AiResult<T> = {
  value: T;
  model: string;
  responseId: string | null;
};

export interface AiGateway {
  interpretTripCreation(request: TripCreationRequest): Promise<AiResult<TripIntentExtraction>>;
}

export const TRIP_CREATION_SYSTEM_PROMPT = `You are TripDock's new-trip intent interpreter. Your only job is to extract structured evidence from a user's free-form request so deterministic application code can resolve and validate it.

Rules:
- Work only on creating a new trip. Never edit, inspect, or make proposals for an existing trip.
- The user input may be an initial request or a follow-up transcript. In a transcript, treat the Original request, Earlier user follow-ups, Manually confirmed fields, and latest User follow-up sections as evidence; unresolved-question wording is context, not a user answer.
- Extract what the user said. Do not silently complete required information.
- Preserve a short verbatim source span in sourceText or evidence for every user-derived value. Use null when there is no supporting evidence.
- Do not calculate ISO dates, choose an implicit year, resolve relative dates, decide numeric date order, roll dates across a year, or validate the calendar. Return the typed date intent and its day/month/year components instead. Use NUMERIC_DATE only for a wholly numeric date such as 05/06 or 05/06/2027; use CALENDAR_DATE for named-month and ISO dates. A date without a year must have year: null.
- Classify every destination as CITY, COUNTRY, REGION, PREFERENCE, AMBIGUOUS, or UNKNOWN. CITY includes towns and municipalities. A broad area or travel preference is not a city.
- If the user named a city, use origin USER_EXPLICIT. If you infer a possible city from a broad or ambiguous request, keep the broad localityKind, use origin AI_SUGGESTED, and put up to four plausible cities in candidates; never pretend the user selected one.
- Treat contradictions, invalid-looking dates, month-only dates, uncertainty, and alternatives as unresolved evidence. Do not choose on the user's behalf.
- NEXT_WEEKEND always describes a Saturday-Sunday range and never includes Friday. THIS_FRIDAY is a single date intent. Application code will resolve both using the user's local reference date.
- When a single trip-wide NEXT_WEEKEND expression is given, assign NEXT_WEEKEND to both trip startDate and endDate. For a clearly single-day trip date, assign the same intent to both boundaries. Otherwise leave an unstated boundary MISSING.
- Keep destination arrival/departure intents separate from trip-wide dates. Do not copy them unless the user tied them together.
- Extract destinationArea when the user names a trip-wide country or region. For example, in “a trip to Italy, 4 days in Rome and 3 in Naples”, Italy is the destinationArea while Rome and Naples are city destinations. Do not turn the country or region into a city stop when specific cities are also listed.
- Extract a trip name only when the user deliberately names or titles the trip (for example, “call it Summer in Italy”); a phrase such as “trip to Italy” is an area, not an explicit title. Otherwise return null/MISSING. Application code will derive a display name.
- Traveler count may be deterministically interpreted from evidence such as "me and my partner"; label that DETERMINISTIC. Never guess a count.
- Preserve whether a stated duration is in DAYS, FULL_DAYS, NIGHTS, or WEEKS and quote its evidence. Use FULL_DAYS only when the user explicitly says “full days”. Use MISSING with null when none was stated; do not convert calendar months into days.
- Capture a duration attached to an individual destination in that destination's stayDuration. Its evidence must include both the duration phrase and the destination, such as “4 days in Rome”. Do not combine these into the trip-wide duration.
- Put concise extraction caveats in warnings and user-stated assumptions in assumptions. Do not return prose outside the schema.`;

function extractRefusal(response: unknown): string | null {
  const output = (response as { output?: Array<{ content?: Array<{ type?: string; refusal?: string }> }> })
    .output;
  for (const item of output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && content.refusal) return content.refusal;
    }
  }
  return null;
}

function classifyProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const candidate = error as { name?: string; status?: number; message?: string; code?: string };
  const safeMessage = candidate.message ?? '';
  if (candidate.name?.includes('Timeout') || candidate.code === 'ETIMEDOUT') {
    return new AppError('OpenAI did not respond before the request timed out.', 'AI_TIMEOUT');
  }
  if (
    candidate.status === 400 &&
    /structured|json.schema|response.format|unsupported/i.test(safeMessage)
  ) {
    return new AppError(
      'The configured OpenAI model does not support the required Structured Outputs request.',
      'AI_MODEL_UNSUPPORTED',
    );
  }
  return new AppError('OpenAI could not complete this request. Try again.', 'AI_PROVIDER_ERROR');
}

function requireCompletedResponse(
  response: {
    status?: string;
    error?: { code?: string } | null;
    incomplete_details?: { reason?: string } | null;
  },
  outputLabel: string,
): void {
  if (response.status === 'completed') return;
  if (response.status === 'incomplete') {
    const suffix = response.incomplete_details?.reason === 'content_filter'
      ? ' because content filtering stopped generation'
      : response.incomplete_details?.reason === 'max_output_tokens'
        ? ' because the output limit was reached'
        : '';
    throw new AppError(`OpenAI returned an incomplete ${outputLabel}${suffix}.`, 'AI_INCOMPLETE');
  }
  if (response.status === 'failed') {
    throw new AppError('OpenAI could not complete this request. Try again.', 'AI_PROVIDER_ERROR', {
      providerCode: response.error?.code ?? 'response_failed',
    });
  }
  if (response.status === 'cancelled') {
    throw new AppError('The OpenAI request was cancelled before completion.', 'AI_PROVIDER_ERROR');
  }
  throw new AppError('OpenAI did not return a completed response.', 'AI_PROVIDER_ERROR');
}

export class OpenAiGateway implements AiGateway {
  private readonly client: OpenAI;

  constructor(
    private readonly model: string,
    apiKey: string,
  ) {
    if (!apiKey.trim() || !model.trim()) {
      throw new AppError(
        'Set OPENAI_API_KEY and OPENAI_MODEL on the API server to use AI planning.',
        'AI_NOT_CONFIGURED',
      );
    }
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async interpretTripCreation(request: TripCreationRequest): Promise<AiResult<TripIntentExtraction>> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        instructions: TRIP_CREATION_SYSTEM_PROMPT,
        input: [
          {
            role: 'developer',
            content: `Runtime context (authoritative): locale=${request.locale}; timezone=${request.timeZone}; local reference date=${request.referenceDate}. Extract relative expressions but leave their resolution to application code.`,
          },
          { role: 'user', content: request.prompt },
        ],
        text: {
          format: zodTextFormat(
            tripIntentExtractionSchema,
            'tripdock_trip_intent_v3',
          ),
        },
      });
      const refusal = extractRefusal(response);
      if (refusal) throw new AppError('OpenAI declined this trip-draft request.', 'AI_REFUSAL');
      requireCompletedResponse(response, 'trip draft');
      const parsed = tripIntentExtractionSchema.safeParse(response.output_parsed);
      if (!parsed.success) {
        throw new AppError('OpenAI returned an interpretation that failed server validation.', 'AI_INVALID_OUTPUT');
      }
      return {
        value: parsed.data,
        model: response.model,
        responseId: response.id,
      };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

export class FixtureAiGateway implements AiGateway {
  readonly calls: Array<{ kind: 'draft'; request: TripCreationRequest }> = [];

  constructor(private readonly extraction: TripIntentExtraction) {}

  async interpretTripCreation(request: TripCreationRequest): Promise<AiResult<TripIntentExtraction>> {
    this.calls.push({ kind: 'draft', request: structuredClone(request) });
    return {
      value: tripIntentExtractionSchema.parse(structuredClone(this.extraction)),
      model: 'fixture-tripdock-v1',
      responseId: 'fixture-draft-response',
    };
  }
}

export class UnconfiguredAiGateway implements AiGateway {
  private fail(): never {
    throw new AppError(
      'Set OPENAI_API_KEY and OPENAI_MODEL on the API server to use AI planning.',
      'AI_NOT_CONFIGURED',
    );
  }

  async interpretTripCreation(_request: TripCreationRequest): Promise<AiResult<TripIntentExtraction>> {
    return this.fail();
  }
}
