import { DECISIONS, type Decision } from '../schemas/enums.js';
import type { EvaluationBody, JevCallResult, ProviderErrorCode } from './types.js';
import { sanitizeText } from '../utils/redact.js';

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function interpretEvaluation(body: EvaluationBody): JevCallResult {
  const selected = body.answers?.release_decision;
  if (!selected || selected.type !== 'choice' || typeof selected.choice !== 'string') {
    return { status: 'schema_rejected', error_code: 'schema_rejected', message: 'SCHEMA_REJECTED: missing release_decision choice' };
  }
  if (!(DECISIONS as readonly string[]).includes(selected.choice)) {
    return {
      status: 'schema_rejected',
      error_code: 'schema_rejected',
      message: `SCHEMA_REJECTED: release_decision ${selected.choice} is not allowed`,
    };
  }
  const typesafe = body.providerMetadata?.typesafe?.confidence?.release_decision;
  const confidence = clampConfidence(
    typesafe ?? body.confidence?.release_decision ?? selected.confidence ?? selected.probability ?? 0,
  );
  const abstain = body.answers?.abstain;
  const abstainProbability = abstain?.type === 'boolean' ? abstain.probability : undefined;
  return {
    status: 'evaluated',
    decision: selected.choice as Decision,
    confidence,
    explanation: `Jev proposed ${selected.choice}`,
    abstain: (abstainProbability ?? 0) >= 0.55,
  };
}

export function unavailable(message: string, errorCode: Exclude<ProviderErrorCode, 'schema_rejected'> = 'provider_error'): JevCallResult {
  return { status: 'unavailable', error_code: errorCode, message: sanitizeText(message, 500) };
}

export function schemaRejected(message: string): JevCallResult {
  return { status: 'schema_rejected', error_code: 'schema_rejected', message: sanitizeText(message, 500) };
}

export function classifyProviderError(error: unknown): Exclude<ProviderErrorCode, 'schema_rejected'> {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out/i.test(message)) return 'timeout';
  if (/\b401\b|unauthori[sz]ed/i.test(message)) return 'unauthorized';
  if (/\b429\b|rate.?limit/i.test(message)) return 'rate_limited';
  if (/\b\d{3}\b/.test(message)) return 'http_error';
  return 'network_error';
}
