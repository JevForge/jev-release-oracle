import type { Decision, EnvironmentName, JevProviderId, JevStatus } from '../schemas/enums.js';
import type { ReleaseRiskReport } from '../schemas/oracle.js';

export interface ReleaseEvaluationState {
  environment: EnvironmentName;
  target_ref: string;
  base_ref: string | null;
  policyFloor: Decision;
  risk: ReleaseRiskReport['risk'];
  checks: ReleaseRiskReport['checks'];
  deployments: ReleaseRiskReport['deployments'];
  changelog: ReleaseRiskReport['changelog'];
  sample: {
    commits: Array<{ sha: string; message: string; breaking?: boolean }>;
    findings: Array<{ id: string; severity: string; title: string }>;
    incidents: Array<{ id: string; severity: string; status: string; title: string }>;
    metrics: Array<{ name: string; value: number; breached: boolean }>;
  };
  source_error_count: number;
  note: string;
}

export const PROVIDER_ERROR_CODES = [
  'secret_missing',
  'configuration',
  'unauthorized',
  'rate_limited',
  'timeout',
  'http_error',
  'network_error',
  'schema_rejected',
  'provider_error',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export type JevCallResult =
  | {
      status: 'evaluated';
      decision: Decision;
      confidence: number;
      explanation: string;
      abstain: boolean;
    }
  | { status: 'unavailable'; message: string; error_code?: Exclude<ProviderErrorCode, 'schema_rejected'> }
  | { status: 'schema_rejected'; message: string; error_code?: 'schema_rejected' };

export interface JevProvider {
  readonly id: JevProviderId;
  evaluateRelease(state: ReleaseEvaluationState): Promise<JevCallResult>;
}

export interface JevProviderOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface EvaluationAnswer {
  type?: string;
  choice?: string;
  probability?: number;
  confidence?: number;
}

export interface EvaluationBody {
  answers?: Record<string, EvaluationAnswer>;
  confidence?: Record<string, number>;
  providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
}

export type { JevStatus };
