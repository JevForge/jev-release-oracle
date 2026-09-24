import { DECISIONS, type Decision } from '../schemas/enums.js';
import type { EvaluationBody, JevCallResult } from './types.js';

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function interpretEvaluation(body: EvaluationBody): JevCallResult {
  const selected = body.answers?.release_decision;
  if (!selected || selected.type !== 'choice' || typeof selected.choice !== 'string') {
    return { status: 'schema_rejected', message: 'SCHEMA_REJECTED: missing release_decision choice' };
  }
  if (!(DECISIONS as readonly string[]).includes(selected.choice)) {
    return {
      status: 'schema_rejected',
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

export function unavailable(message: string): JevCallResult {
  return { status: 'unavailable', message: message.slice(0, 500) };
}
