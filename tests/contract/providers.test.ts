import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  createGateway: () => ({
    evaluationModel: (modelId: string) => ({ modelId }),
  }),
  experimental_evaluate: vi.fn(),
}));

import { experimental_evaluate } from 'ai';
import { createJevProvider } from '../../src/jev/factory.js';
import { buildEvaluationState } from '../../src/jev/questions.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';

const evaluate = vi.mocked(experimental_evaluate);
const report = buildReleaseRiskReport({
  target_ref: 'abc',
  base_ref: 'v1',
  environment: 'production',
});
const state = buildEvaluationState(report, 'proceed', 40);

describe('Jev providers', () => {
  beforeEach(() => {
    evaluate.mockReset();
  });

  it('calls experimental_evaluate on typesafe-ai/jev and does not use generateText', async () => {
    const source = readFileSync(new URL('../../src/jev/vercel-ai-gateway.ts', import.meta.url), 'utf8');
    expect(source).toContain('experimental_evaluate');
    expect(source).not.toContain('generateText');
    evaluate.mockResolvedValue({
      answers: {
        release_decision: { type: 'choice', choice: 'warn', probability: 0.91 },
        abstain: { type: 'boolean', probability: 0.05 },
      },
      providerMetadata: { typesafe: { confidence: { release_decision: 0.91 } } },
    } as never);
    const provider = createJevProvider({
      provider: 'vercel-ai-gateway',
      apiKey: 'test-key',
      timeoutMs: 1000,
    });
    const answer = await provider.evaluateRelease(state);
    expect(answer.status).toBe('evaluated');
    if (answer.status === 'evaluated') {
      expect(answer.decision).toBe('warn');
      expect(answer.confidence).toBe(0.91);
    }
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: 'typesafe-ai/jev' },
      }),
    );
  });

  it('does not fall back to another provider when the gateway key is missing', async () => {
    const provider = createJevProvider({ provider: 'vercel-ai-gateway', timeoutMs: 1000 });
    const answer = await provider.evaluateRelease(state);
    expect(answer.status).toBe('unavailable');
    if (answer.status === 'unavailable') {
      expect(answer.message).toContain('vercel-ai-gateway');
      expect(answer.message).not.toContain('typesafe-native');
    }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('normalizes native and custom HTTPS answers to the same choice contract', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answers: {
            release_decision: { type: 'choice', choice: 'review' },
            abstain: { type: 'boolean', probability: 0.1 },
          },
          confidence: { release_decision: 0.66 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const native = createJevProvider({
      provider: 'typesafe-native',
      apiKey: 'native-key',
      endpoint: 'https://jev.example/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
      fetchImpl,
    });
    const custom = createJevProvider({
      provider: 'custom-compatible',
      apiKey: 'custom-key',
      endpoint: 'https://jev.example/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
      fetchImpl,
    });
    const nativeAnswer = await native.evaluateRelease(state);
    const customAnswer = await custom.evaluateRelease(state);
    expect(nativeAnswer).toEqual(customAnswer);
    expect(nativeAnswer.status).toBe('evaluated');
  });

  it('rejects malformed choices and HTTP failures without proceeding', async () => {
    const malformed = createJevProvider({
      provider: 'custom-compatible',
      apiKey: 'custom-key',
      endpoint: 'https://jev.example/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ answers: { release_decision: { type: 'choice', choice: 'ship' } } }), {
          status: 200,
        })) as typeof fetch,
    });
    const rejected = await malformed.evaluateRelease(state);
    expect(rejected.status).toBe('schema_rejected');

    const down = createJevProvider({
      provider: 'typesafe-native',
      apiKey: 'native-key',
      endpoint: 'https://jev.example/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
      fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
    });
    const answer = await down.evaluateRelease(state);
    expect(answer.status).toBe('unavailable');

    const insecure = createJevProvider({
      provider: 'custom-compatible',
      apiKey: 'custom-key',
      endpoint: 'http://jev.example/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
    });
    const bad = await insecure.evaluateRelease(state);
    expect(bad.status).toBe('unavailable');
    if (bad.status === 'unavailable') expect(bad.message).toMatch(/HTTPS/);
  });
});
