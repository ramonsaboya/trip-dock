import { OpenAiGateway } from '../ai.js';
import { readRuntimeConfig } from '../config.js';

const config = readRuntimeConfig();
if (!config.openAiApiKey || !config.openAiModel) {
  console.log('Live OpenAI smoke skipped: set OPENAI_API_KEY and OPENAI_MODEL to run it.');
  process.exitCode = 2;
} else {
  const gateway = new OpenAiGateway(config.openAiModel, config.openAiApiKey);
  const result = await gateway.generateTripDraft(
    'Plan a two-person trip called A quiet Lisbon weekend, in Lisbon, from 2027-05-14 to 2027-05-17, with Lisbon as the only stop.',
  );
  console.log(
    JSON.stringify({
      ok: true,
      requestedModel: config.openAiModel,
      responseModel: result.model,
      responseIdPresent: Boolean(result.responseId),
      stopCount: result.value.stops.length,
    }),
  );
}
