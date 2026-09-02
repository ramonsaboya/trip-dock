import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

import {
  AppError,
  tripDraftSchema,
  type TripDraft,
} from './domain.js';

export type AiResult<T> = {
  value: T;
  model: string;
  responseId: string | null;
};

export interface AiGateway {
  generateTripDraft(prompt: string): Promise<AiResult<TripDraft>>;
}

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

  async generateTripDraft(prompt: string): Promise<AiResult<TripDraft>> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        instructions:
          'Create a concise travel-plan draft for human review. Never invent missing dates or traveler counts; use null and explain uncertainty in warnings. Keep stops ordered. destinationArea is internal compatibility metadata: derive it quietly and never mention it in assumptions or warnings. Do not include bookings, credentials, or prose outside the schema.',
        input: prompt,
        text: { format: zodTextFormat(tripDraftSchema, 'tripdock_trip_draft_v1') },
      });
      const refusal = extractRefusal(response);
      if (refusal) throw new AppError('OpenAI declined this trip-draft request.', 'AI_REFUSAL');
      requireCompletedResponse(response, 'trip draft');
      const parsed = tripDraftSchema.safeParse(response.output_parsed);
      if (!parsed.success) {
        throw new AppError('OpenAI returned a draft that failed server validation.', 'AI_INVALID_OUTPUT');
      }
      return { value: parsed.data, model: response.model, responseId: response.id };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

export class FixtureAiGateway implements AiGateway {
  readonly calls: Array<{ kind: 'draft'; prompt: string }> = [];

  constructor(private readonly draft: TripDraft) {}

  async generateTripDraft(prompt: string): Promise<AiResult<TripDraft>> {
    this.calls.push({ kind: 'draft', prompt });
    return {
      value: tripDraftSchema.parse(structuredClone(this.draft)),
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

  async generateTripDraft(_prompt: string): Promise<AiResult<TripDraft>> {
    return this.fail();
  }
}
