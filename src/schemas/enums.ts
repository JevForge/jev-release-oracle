export const DECISIONS = ['proceed', 'warn', 'hold', 'review'] as const;
export type Decision = (typeof DECISIONS)[number];

export const JEV_PROVIDERS = [
  'vercel-ai-gateway',
  'typesafe-native',
  'custom-compatible',
] as const;
export type JevProviderId = (typeof JEV_PROVIDERS)[number];

export const LOW_CONFIDENCE_POLICIES = ['fail', 'warn', 'request-review', 'no-op'] as const;
export type LowConfidencePolicy = (typeof LOW_CONFIDENCE_POLICIES)[number];

export const REVIEW_MODES = ['fail', 'continue'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const SOURCE_ERROR_POLICIES = ['fail', 'warn'] as const;
export type SourceErrorPolicy = (typeof SOURCE_ERROR_POLICIES)[number];

export const JEV_STATUSES = ['evaluated', 'unavailable', 'schema_rejected'] as const;
export type JevStatus = (typeof JEV_STATUSES)[number];

export const ENVIRONMENTS = ['production', 'staging', 'development', 'other'] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const INCIDENT_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4', 'unknown'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const CHECK_CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'timed_out',
  'action_required',
  'stale',
  'skipped',
  'pending',
  'unknown',
] as const;
export type CheckConclusion = (typeof CHECK_CONCLUSIONS)[number];

export const DEPLOY_STATES = ['success', 'failure', 'pending', 'inactive', 'error', 'unknown'] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];

export const RECOMMENDED_CHECKS = [
  'rerun-failed-tests',
  'security-review',
  'changelog-review',
  'incident-review',
  'slo-review',
  'manual-qa',
  'canary-first',
  'rollback-plan',
] as const;
export type RecommendedCheck = (typeof RECOMMENDED_CHECKS)[number];

export const REASON_CODES = [
  'ALL_CHECKS_GREEN',
  'TESTS_FAILED',
  'CHECKS_PENDING',
  'CRITICAL_VULN',
  'HIGH_VULN',
  'BREAKING_CHANGE',
  'CHANGELOG_MISSING',
  'CHANGELOG_OK',
  'OPEN_INCIDENT',
  'RECENT_INCIDENT',
  'SLO_BREACH',
  'METRICS_OK',
  'LARGE_CHANGESET',
  'NO_SIGNALS',
  'POLICY_FLOOR_HOLD',
  'POLICY_FLOOR_WARN',
  'POLICY_FLOOR_REVIEW',
  'JEV_ESCALATED',
  'JEV_AGREED',
  'JEV_ABSTAIN',
  'LOW_CONFIDENCE',
  'JEV_UNAVAILABLE',
  'SCHEMA_REJECTED',
  'SOURCE_UNAVAILABLE',
  'DEPLOY_FAILED',
  'DEPLOY_PENDING',
  'RECOMMENDED_CHECKS',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DECISION_RANK: Record<Decision, number> = {
  proceed: 0,
  warn: 1,
  review: 2,
  hold: 3,
};
