import { createGateway, experimental_evaluate as evaluate } from 'ai';
import type { JevProvider, JevProviderOptions, ReleaseEvaluationState } from './types.js';
import { buildReleaseQuestions, summarizeState } from './questions.js';
import { interpretEvaluation, unavailable } from './normalize.js';
import type { EvaluationBody } from './types.js';

export interface GatewayEvaluate {
  (input: {
    modelId: string;
    state: ReturnType<typeof summarizeState>;
    timeoutMs: number;
    apiKey: string;
  }): Promise<EvaluationBody>;
}

export const defaultGatewayEvaluate: GatewayEvaluate = async input => {
  const gateway = createGateway({ apiKey: input.apiKey });
  const result = await evaluate({
    model: gateway.evaluationModel(input.modelId),
    state: JSON.parse(JSON.stringify(input.state)),
    questions: buildReleaseQuestions(),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
    providerOptions: {
      gateway: { zeroDataRetention: true },
    },
  });
  return result as EvaluationBody;
};

export function createVercelAiGatewayProvider(
  options: JevProviderOptions & { evaluateImpl?: GatewayEvaluate },
): JevProvider {
  const evaluateImpl = options.evaluateImpl ?? defaultGatewayEvaluate;
  return {
    id: 'vercel-ai-gateway',
    async evaluateRelease(state: ReleaseEvaluationState) {
      if (!options.apiKey) return unavailable('AI_GATEWAY_API_KEY is required for vercel-ai-gateway');
      try {
        const body = await evaluateImpl({
          modelId: options.model ?? 'typesafe-ai/jev',
          state: summarizeState(state),
          timeoutMs: options.timeoutMs,
          apiKey: options.apiKey,
        });
        return interpretEvaluation(body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return unavailable(`vercel-ai-gateway error: ${message}`);
      }
    },
  };
}
