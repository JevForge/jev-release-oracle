import type { EvaluationBody } from './types.js';
import { interpretEvaluation, unavailable } from './normalize.js';

export async function postEvaluate(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  state: unknown;
  questions: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  providerLabel: string;
}): Promise<ReturnType<typeof interpretEvaluation> | ReturnType<typeof unavailable>> {
  try {
    const response = await options.fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        state: options.state,
        questions: options.questions,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) return unavailable(`${options.providerLabel} HTTP ${response.status}`);
    return interpretEvaluation((await response.json()) as EvaluationBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`${options.providerLabel} error: ${message}`);
  }
}
