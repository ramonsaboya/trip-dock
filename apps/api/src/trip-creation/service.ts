import { ZodError } from 'zod';
import type { AiGateway } from '../ai.js';
import { AppError, parseInput as parse } from '../domain.js';
import { buildTripCreationDraft, tripCreationRequestSchema } from '../trip-creation.js';

export async function generateTripDraft(aiGateway: AiGateway, args: { input: unknown }) {
  const request = parse(tripCreationRequestSchema, args.input);
  const result = await aiGateway.interpretTripCreation(request);
  try {
    return buildTripCreationDraft(result.value, request);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(
        'The AI interpretation could not be converted into a safe trip draft.',
        'AI_INVALID_OUTPUT',
      );
    }
    throw error;
  }
}
