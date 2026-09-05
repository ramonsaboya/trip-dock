import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { OpenAiGateway, TRIP_CREATION_SYSTEM_PROMPT } from '../ai.js';
import { readRuntimeConfig } from '../config.js';
import { evaluateTripCreationResult, type TripCreationEvalSuite } from '../evals/trip-creation-eval.js';
import {
  TRIP_CREATION_EVAL_CORPUS_VERSION,
  tripCreationEvalScenarios,
} from '../evals/trip-creation-scenarios.js';
import { buildTripCreationDraft } from '../trip-creation.js';

type ParsedArguments = {
  suite: TripCreationEvalSuite | 'ALL';
  scenarioId: string | null;
  trials: number;
};

function parseArguments(): ParsedArguments {
  const values = new Map<string, string>();
  const supported = new Set(['--suite', '--scenario', '--trials']);
  const rawArguments = process.argv.slice(2).filter((argument) => argument !== '--');
  for (let index = 0; index < rawArguments.length; index += 1) {
    const argument = rawArguments[index]!;
    const equalsIndex = argument.indexOf('=');
    const name = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (!supported.has(name)) throw new Error(`Unknown option ${name}.`);
    const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : rawArguments[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    values.set(name, value);
  }

  const rawSuite = (values.get('--suite') ?? 'all').toUpperCase();
  if (!['ALL', 'REGRESSION', 'CAPABILITY'].includes(rawSuite)) {
    throw new Error('--suite must be all, regression, or capability.');
  }

  const rawTrials = values.get('--trials') ?? '1';
  const trials = Number(rawTrials);
  if (!Number.isInteger(trials) || trials < 1 || trials > 10) {
    throw new Error('--trials must be an integer between 1 and 10.');
  }

  return {
    suite: rawSuite as ParsedArguments['suite'],
    scenarioId: values.get('--scenario') ?? null,
    trials,
  };
}

function printable(value: unknown): string {
  return JSON.stringify(value);
}

if (process.argv.includes('--help')) {
  console.log(`Usage: pnpm test:ai-eval -- [options]

Options:
  --suite all|regression|capability  Select a suite (default: all)
  --scenario <id>                   Run one scenario family
  --trials <1-10>                   Repeat every prompt variant (default: 1)

Regression failures exit with status 1. Capability failures are reported but do not block.`);
} else {
  let args: ParsedArguments;
  try {
    args = parseArguments();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid arguments.');
    process.exitCode = 2;
    args = { suite: 'ALL', scenarioId: '__invalid__', trials: 1 };
  }

  const selectedScenarios = tripCreationEvalScenarios.filter(
    (scenario) =>
      (args.suite === 'ALL' || scenario.suite === args.suite) &&
      (args.scenarioId === null || scenario.id === args.scenarioId),
  );

  if (process.exitCode !== 2 && selectedScenarios.length === 0) {
    console.error(`No trip-creation eval scenario matched ${args.scenarioId ?? args.suite}.`);
    process.exitCode = 2;
  }

  const config = readRuntimeConfig();
  if (process.exitCode !== 2 && (!config.openAiApiKey || !config.openAiModel)) {
    console.log(
      'Trip-creation live eval skipped: set OPENAI_API_KEY and OPENAI_MODEL to run it.',
    );
    process.exitCode = 2;
  } else if (process.exitCode !== 2) {
    const gateway = new OpenAiGateway(config.openAiModel, config.openAiApiKey);
    const promptHash = createHash('sha256')
      .update(TRIP_CREATION_SYSTEM_PROMPT)
      .digest('hex')
      .slice(0, 12);
    const totals = {
      cases: 0,
      passed: 0,
      failed: 0,
      regressionFailures: 0,
      capabilityFailures: 0,
      providerErrors: 0,
      checks: 0,
    };
    const responseModels = new Set<string>();

    console.log(
      `Trip creation eval corpus=${TRIP_CREATION_EVAL_CORPUS_VERSION} prompt=${promptHash} requestedModel=${config.openAiModel}`,
    );

    for (const scenario of selectedScenarios) {
      for (const variant of scenario.variants) {
        for (let trial = 1; trial <= args.trials; trial += 1) {
          totals.cases += 1;
          const caseId = `${scenario.id}/${variant.id}#${trial}`;
          const request = { ...scenario.context, prompt: variant.prompt };
          const startedAt = performance.now();

          try {
            const aiResult = await gateway.interpretTripCreation(request);
            responseModels.add(aiResult.model);
            const draft = buildTripCreationDraft(aiResult.value, request);
            const evaluation = evaluateTripCreationResult(scenario, aiResult.value, draft);
            const latencyMs = Math.round(performance.now() - startedAt);
            totals.checks += evaluation.checks;

            if (evaluation.passed) {
              totals.passed += 1;
              console.log(`PASS [${scenario.suite}] ${caseId} (${latencyMs}ms)`);
              continue;
            }

            totals.failed += 1;
            if (evaluation.releaseBlocking) totals.regressionFailures += 1;
            else totals.capabilityFailures += 1;
            console.log(
              `${evaluation.releaseBlocking ? 'FAIL' : 'TARGET'} [${scenario.suite}] ${caseId} (${latencyMs}ms)`,
            );
            for (const failure of evaluation.failures) {
              console.log(
                `  ${failure.layer}.${failure.path}: expected ${printable(failure.expected)}, got ${printable(failure.actual)}`,
              );
            }
          } catch (error) {
            totals.failed += 1;
            totals.providerErrors += 1;
            if (scenario.suite === 'REGRESSION') totals.regressionFailures += 1;
            else totals.capabilityFailures += 1;
            const latencyMs = Math.round(performance.now() - startedAt);
            console.log(
              `ERROR [${scenario.suite}] ${caseId} (${latencyMs}ms): ${error instanceof Error ? error.message : 'Unknown provider error'}`,
            );
          }
        }
      }
    }

    console.log(
      JSON.stringify({
        corpusVersion: TRIP_CREATION_EVAL_CORPUS_VERSION,
        promptHash,
        requestedModel: config.openAiModel,
        responseModels: [...responseModels],
        selectedSuite: args.suite,
        selectedScenario: args.scenarioId,
        trials: args.trials,
        ...totals,
      }),
    );
    if (totals.regressionFailures > 0 || totals.providerErrors > 0) process.exitCode = 1;
  }
}
