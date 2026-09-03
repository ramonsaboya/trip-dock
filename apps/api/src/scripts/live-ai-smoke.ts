import { OpenAiGateway } from '../ai.js';
import { readRuntimeConfig } from '../config.js';
import { buildTripCreationDraft } from '../trip-creation.js';

const config = readRuntimeConfig();
if (!config.openAiApiKey || !config.openAiModel) {
  console.log('Live OpenAI smoke skipped: set OPENAI_API_KEY and OPENAI_MODEL to run it.');
  process.exitCode = 2;
} else {
  const gateway = new OpenAiGateway(config.openAiModel, config.openAiApiKey);
  const request = {
    prompt: 'Plan a two-person trip called A quiet Lisbon weekend, in Lisbon, from 2027-05-14 to 2027-05-17, with Lisbon as the only stop.',
    locale: 'en-GB',
    timeZone: 'Europe/London',
    referenceDate: '2026-09-03',
  };
  const result = await gateway.interpretTripCreation(request);
  const draft = buildTripCreationDraft(result.value, request);
  console.log(
    JSON.stringify({
      ok: true,
      requestedModel: config.openAiModel,
      responseModel: result.model,
      responseIdPresent: Boolean(result.responseId),
      stopCount: draft.stops.length,
    }),
  );
}
