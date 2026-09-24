import type { JevProvider, JevProviderOptions, ReleaseEvaluationState } from './types.js';
import { buildReleaseQuestions, summarizeState } from './questions.js';
import { unavailable } from './normalize.js';
import { postEvaluate } from './http-evaluate.js';

export function createCustomCompatibleProvider(options: JevProviderOptions): JevProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: 'custom-compatible',
    async evaluateRelease(state: ReleaseEvaluationState) {
      if (!options.apiKey) return unavailable('JEV_CUSTOM_API_KEY is required for custom-compatible', 'secret_missing');
      if (!options.endpoint) return unavailable('jev_endpoint is required for custom-compatible', 'configuration');
      if (!options.endpoint.startsWith('https://')) {
        return unavailable('jev_endpoint must be HTTPS for custom-compatible', 'configuration');
      }
      if (!options.model) return unavailable('jev_model is required for custom-compatible', 'configuration');
      return postEvaluate({
        endpoint: options.endpoint,
        apiKey: options.apiKey,
        model: options.model,
        state: summarizeState(state),
        questions: buildReleaseQuestions(),
        timeoutMs: options.timeoutMs,
        fetchImpl,
        providerLabel: 'custom-compatible',
      });
    },
  };
}
