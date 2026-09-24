import type { JevProvider, JevProviderOptions, ReleaseEvaluationState } from './types.js';
import { buildReleaseQuestions, summarizeState } from './questions.js';
import { unavailable } from './normalize.js';
import { postEvaluate } from './http-evaluate.js';

export function createTypesafeNativeProvider(options: JevProviderOptions): JevProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.typesafe.ai/v1/evaluate';
  return {
    id: 'typesafe-native',
    async evaluateRelease(state: ReleaseEvaluationState) {
      if (!options.apiKey) return unavailable('TYPESAFE_API_KEY is required for typesafe-native', 'secret_missing');
      if (!options.model) {
        return unavailable('jev_model is required for typesafe-native (pin a catalog model id)', 'configuration');
      }
      if (!endpoint.startsWith('https://')) {
        return unavailable('typesafe-native endpoint must be HTTPS', 'configuration');
      }
      return postEvaluate({
        endpoint,
        apiKey: options.apiKey,
        model: options.model,
        state: summarizeState(state),
        questions: buildReleaseQuestions(),
        timeoutMs: options.timeoutMs,
        fetchImpl,
        providerLabel: 'typesafe-native',
      });
    },
  };
}
