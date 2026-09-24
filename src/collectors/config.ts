import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import {
  ENVIRONMENTS,
  JEV_PROVIDERS,
  LOW_CONFIDENCE_POLICIES,
  REVIEW_MODES,
  SOURCE_ERROR_POLICIES,
  type EnvironmentName,
  type JevProviderId,
  type LowConfidencePolicy,
  type ReviewMode,
  type SourceErrorPolicy,
} from '../schemas/enums.js';
import { z } from 'zod';

const FileConfigSchema = z
  .object({
    target_ref: z.string().min(1).optional(),
    base_ref: z.string().min(1).optional(),
    signals: z.string().optional(),
    signals_path: z.string().optional(),
    changelog_path: z.string().optional(),
    findings_path: z.string().optional(),
    findings: z.string().optional(),
    sarif_path: z.string().optional(),
    incidents_path: z.string().optional(),
    metrics_path: z.string().optional(),
    metrics: z.string().optional(),
    baseline_path: z.string().optional(),
    baseline_mode: z.enum(['all', 'new_only']).optional(),
    sentinel_decision: z.string().optional(),
    sentinel_findings: z.string().optional(),
    cost_decision: z.string().optional(),
    cost_metrics: z.string().optional(),
    fetch_github_compare: z.boolean().optional(),
    fetch_checks: z.boolean().optional(),
    fetch_deployments: z.boolean().optional(),
    incident_labels: z.union([z.string(), z.array(z.string())]).optional(),
    environment: z.enum(ENVIRONMENTS).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).optional(),
    review_mode: z.enum(REVIEW_MODES).optional(),
    fail_on_warn: z.boolean().optional(),
    source_error_policy: z.enum(SOURCE_ERROR_POLICIES).optional(),
    jev_provider: z.enum(JEV_PROVIDERS).optional(),
    jev_endpoint: z.string().optional(),
    jev_model: z.string().optional(),
    timeout_ms: z.number().int().positive().max(120_000).optional(),
    max_items_to_jev: z.number().int().positive().max(200).optional(),
    comment_on_github: z.boolean().optional(),
    create_check_run: z.boolean().optional(),
    write_report_artifact: z.boolean().optional(),
    request_reviewers: z.string().optional(),
    structured_logs: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof FileConfigSchema>;

export interface RawActionInputs {
  [key: string]: string | undefined;
}

export interface OracleConfig {
  targetRef?: string;
  baseRef: string | null;
  signalsJson?: string;
  signalsPath?: string;
  changelogPath?: string;
  findingsPath?: string;
  findingsJson?: string;
  sarifPath?: string;
  incidentsPath?: string;
  metricsPath?: string;
  metricsJson?: string;
  baselinePath?: string;
  baselineMode: 'all' | 'new_only';
  sentinelDecision?: string;
  sentinelFindings?: string;
  costDecision?: string;
  costMetrics?: string;
  fetchGithubCompare: boolean;
  fetchChecks: boolean;
  fetchDeployments: boolean;
  incidentLabels: string[];
  environment: EnvironmentName;
  minConfidence: number;
  lowConfidencePolicy: LowConfidencePolicy;
  reviewMode: ReviewMode;
  failOnWarn: boolean;
  sourceErrorPolicy: SourceErrorPolicy;
  jevProvider: JevProviderId;
  jevEndpoint?: string;
  jevModel?: string;
  timeoutMs: number;
  maxItemsToJev: number;
  commentOnGithub: boolean;
  createCheckRun: boolean;
  writeReportArtifact: boolean;
  requestReviewers?: string;
  structuredLogs: boolean;
  dryRun: boolean;
}

const defaults: OracleConfig = {
  baseRef: null,
  baselineMode: 'all',
  fetchGithubCompare: true,
  fetchChecks: true,
  fetchDeployments: false,
  incidentLabels: ['incident', 'sev1', 'sev2'],
  environment: 'production',
  minConfidence: 0.75,
  lowConfidencePolicy: 'fail',
  reviewMode: 'fail',
  failOnWarn: false,
  sourceErrorPolicy: 'fail',
  jevProvider: 'vercel-ai-gateway',
  timeoutMs: 45_000,
  maxItemsToJev: 40,
  commentOnGithub: false,
  createCheckRun: true,
  writeReportArtifact: false,
  structuredLogs: false,
  dryRun: false,
};

function inputValue(inputs: RawActionInputs, key: string): string | undefined {
  const value = inputs[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringOption(inputs: RawActionInputs, key: string, configured: string | undefined): string | undefined {
  return inputValue(inputs, key) ?? (configured?.trim() || undefined);
}

function boolOption(inputs: RawActionInputs, key: string, configured: boolean | undefined, fallback: boolean): boolean {
  const raw = inputValue(inputs, key);
  if (raw !== undefined) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`Invalid boolean input ${key}: ${raw}`);
  }
  return configured ?? fallback;
}

function numberOption(
  inputs: RawActionInputs,
  key: string,
  configured: number | undefined,
  fallback: number,
): number {
  const raw = inputValue(inputs, key);
  if (raw === undefined) return configured ?? fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric input ${key}: ${raw}`);
  return value;
}

function enumOption<T extends string>(
  inputs: RawActionInputs,
  key: string,
  configured: T | undefined,
  fallback: T,
  allowed: readonly T[],
): T {
  const value = (inputValue(inputs, key) ?? configured ?? fallback) as T;
  if (!allowed.includes(value)) throw new Error(`Invalid ${key}: ${value}`);
  return value;
}

function labelsOption(inputs: RawActionInputs, configured: string | string[] | undefined): string[] {
  const raw = inputValue(inputs, 'incident_labels');
  const value = raw ?? configured ?? defaults.incidentLabels;
  return (Array.isArray(value) ? value : value.split(/[\s,\n]+/))
    .map(label => label.trim())
    .filter(Boolean)
    .slice(0, 32);
}

export function loadFileConfig(workspace: string, relativePath = '.jev/config.yml'): FileConfig {
  const text = readWorkspaceText(workspace, relativePath);
  if (text == null) return {};
  try {
    const raw = parseJsonOrYaml(text);
    return FileConfigSchema.parse(raw ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${relativePath}: ${message.slice(0, 800)}`);
  }
}

export function resolveOracleConfig(inputs: RawActionInputs, fileConfig: FileConfig): OracleConfig {
  return {
    targetRef: stringOption(inputs, 'target_ref', fileConfig.target_ref),
    baseRef: stringOption(inputs, 'base_ref', fileConfig.base_ref) ?? null,
    signalsJson: stringOption(inputs, 'signals', fileConfig.signals),
    signalsPath: stringOption(inputs, 'signals_path', fileConfig.signals_path),
    changelogPath: stringOption(inputs, 'changelog_path', fileConfig.changelog_path),
    findingsPath: stringOption(inputs, 'findings_path', fileConfig.findings_path),
    findingsJson: stringOption(inputs, 'findings', fileConfig.findings),
    sarifPath: stringOption(inputs, 'sarif_path', fileConfig.sarif_path),
    incidentsPath: stringOption(inputs, 'incidents_path', fileConfig.incidents_path),
    metricsPath: stringOption(inputs, 'metrics_path', fileConfig.metrics_path),
    metricsJson: stringOption(inputs, 'metrics', fileConfig.metrics),
    baselinePath: stringOption(inputs, 'baseline_path', fileConfig.baseline_path),
    baselineMode: enumOption(inputs, 'baseline_mode', fileConfig.baseline_mode, 'all', ['all', 'new_only']),
    sentinelDecision: stringOption(inputs, 'sentinel_decision', fileConfig.sentinel_decision),
    sentinelFindings: stringOption(inputs, 'sentinel_findings', fileConfig.sentinel_findings),
    costDecision: stringOption(inputs, 'cost_decision', fileConfig.cost_decision),
    costMetrics: stringOption(inputs, 'cost_metrics', fileConfig.cost_metrics),
    fetchGithubCompare: boolOption(inputs, 'fetch_github_compare', fileConfig.fetch_github_compare, defaults.fetchGithubCompare),
    fetchChecks: boolOption(inputs, 'fetch_checks', fileConfig.fetch_checks, defaults.fetchChecks),
    fetchDeployments: boolOption(inputs, 'fetch_deployments', fileConfig.fetch_deployments, defaults.fetchDeployments),
    incidentLabels: labelsOption(inputs, fileConfig.incident_labels),
    environment: enumOption(inputs, 'environment', fileConfig.environment, defaults.environment, ENVIRONMENTS),
    minConfidence: numberOption(inputs, 'min_confidence', fileConfig.min_confidence, defaults.minConfidence),
    lowConfidencePolicy: enumOption(inputs, 'low_confidence_policy', fileConfig.low_confidence_policy, defaults.lowConfidencePolicy, LOW_CONFIDENCE_POLICIES),
    reviewMode: enumOption(inputs, 'review_mode', fileConfig.review_mode, defaults.reviewMode, REVIEW_MODES),
    failOnWarn: boolOption(inputs, 'fail_on_warn', fileConfig.fail_on_warn, defaults.failOnWarn),
    sourceErrorPolicy: enumOption(inputs, 'source_error_policy', fileConfig.source_error_policy, defaults.sourceErrorPolicy, SOURCE_ERROR_POLICIES),
    jevProvider: enumOption(inputs, 'jev_provider', fileConfig.jev_provider, defaults.jevProvider, JEV_PROVIDERS),
    jevEndpoint: stringOption(inputs, 'jev_endpoint', fileConfig.jev_endpoint),
    jevModel: stringOption(inputs, 'jev_model', fileConfig.jev_model),
    timeoutMs: numberOption(inputs, 'timeout_ms', fileConfig.timeout_ms, defaults.timeoutMs),
    maxItemsToJev: numberOption(inputs, 'max_items_to_jev', fileConfig.max_items_to_jev, defaults.maxItemsToJev),
    commentOnGithub: boolOption(inputs, 'comment_on_github', fileConfig.comment_on_github, defaults.commentOnGithub),
    createCheckRun: boolOption(inputs, 'create_check_run', fileConfig.create_check_run, defaults.createCheckRun),
    writeReportArtifact: boolOption(inputs, 'write_report_artifact', fileConfig.write_report_artifact, defaults.writeReportArtifact),
    requestReviewers: stringOption(inputs, 'request_reviewers', fileConfig.request_reviewers),
    structuredLogs: boolOption(inputs, 'structured_logs', fileConfig.structured_logs, defaults.structuredLogs),
    dryRun: boolOption(inputs, 'dry_run', fileConfig.dry_run, defaults.dryRun),
  };
}

export function validateOracleConfig(config: OracleConfig): void {
  if (config.minConfidence < 0 || config.minConfidence > 1) {
    throw new Error(`Invalid min_confidence: ${config.minConfidence}`);
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 120_000) {
    throw new Error(`Invalid timeout_ms: ${config.timeoutMs}`);
  }
  if (!Number.isInteger(config.maxItemsToJev) || config.maxItemsToJev <= 0 || config.maxItemsToJev > 200) {
    throw new Error(`Invalid max_items_to_jev: ${config.maxItemsToJev}`);
  }
  if (config.jevProvider === 'custom-compatible' && (!config.jevEndpoint || !config.jevModel)) {
    throw new Error('custom-compatible requires jev_endpoint and jev_model');
  }
  if (config.jevProvider === 'typesafe-native' && (!config.jevEndpoint || !config.jevModel)) {
    throw new Error('typesafe-native requires jev_endpoint and jev_model');
  }
  if (config.fetchGithubCompare && !config.baseRef) {
    throw new Error('fetch_github_compare=true requires base_ref');
  }
}
