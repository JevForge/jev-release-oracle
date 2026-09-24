import { z } from 'zod';
import {
  CHECK_CONCLUSIONS,
  DECISIONS,
  DEPLOY_STATES,
  ENVIRONMENTS,
  FINDING_SEVERITIES,
  INCIDENT_SEVERITIES,
  JEV_PROVIDERS,
  JEV_STATUSES,
  LOW_CONFIDENCE_POLICIES,
  REASON_CODES,
  RECOMMENDED_CHECKS,
  REVIEW_MODES,
  SOURCE_ERROR_POLICIES,
} from './enums.js';

export const SourceErrorSchema = z
  .object({
    source: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
  })
  .strict();

export type SourceError = z.infer<typeof SourceErrorSchema>;

export const CommitSchema = z
  .object({
    sha: z.string().min(1).max(64),
    message: z.string().max(500),
    author: z.string().max(128).optional(),
    breaking: z.boolean().optional(),
  })
  .strict();

export type CommitInfo = z.infer<typeof CommitSchema>;

export const PullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().max(300),
    labels: z.array(z.string().max(64)).max(32).optional(),
    draft: z.boolean().optional(),
  })
  .strict();

export type PullRequestInfo = z.infer<typeof PullRequestSchema>;

export const CheckSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failure: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    required_failed: z.number().int().nonnegative(),
    conclusions: z.array(z.enum(CHECK_CONCLUSIONS)).max(64),
  })
  .strict();

export type CheckSummary = z.infer<typeof CheckSummarySchema>;

export const DeploymentSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failure: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    latest_state: z.enum(DEPLOY_STATES),
  })
  .strict();

export type DeploymentSummary = z.infer<typeof DeploymentSummarySchema>;

export const ChangelogInfoSchema = z
  .object({
    present: z.boolean(),
    breaking_mentioned: z.boolean(),
    path: z.string().max(512).nullable().optional(),
  })
  .strict();

export type ChangelogInfo = z.infer<typeof ChangelogInfoSchema>;

export const FindingSchema = z
  .object({
    id: z.string().min(1).max(128),
    fingerprint: z.string().max(128).optional(),
    source: z.string().max(64).optional(),
    rule_id: z.string().max(256).optional(),
    path: z.string().max(512).optional(),
    start_line: z.number().int().positive().optional(),
    severity: z.enum(FINDING_SEVERITIES),
    title: z.string().max(300),
    package: z.string().max(200).optional(),
    cve: z.string().max(64).optional(),
  })
  .strict();

export type Finding = z.infer<typeof FindingSchema>;

export const IncidentSchema = z
  .object({
    id: z.string().min(1).max(128),
    severity: z.enum(INCIDENT_SEVERITIES),
    title: z.string().max(300),
    status: z.enum(['open', 'mitigated', 'resolved', 'unknown']),
    opened_at: z.string().max(64).optional(),
    labels: z.array(z.string().max(64)).max(32).optional(),
  })
  .strict();

export type Incident = z.infer<typeof IncidentSchema>;

export const MetricSchema = z
  .object({
    name: z.string().min(1).max(128),
    value: z.number().finite(),
    threshold: z.number().finite().optional(),
    breached: z.boolean(),
    unit: z.string().max(32).optional(),
  })
  .strict();

export type Metric = z.infer<typeof MetricSchema>;

export const UpstreamDecisionSchema = z
  .object({
    source: z.string().min(1).max(64),
    decision: z.enum(DECISIONS),
  })
  .strict();

export type UpstreamDecision = z.infer<typeof UpstreamDecisionSchema>;

export const RiskCountsSchema = z
  .object({
    critical_vulns: z.number().int().nonnegative(),
    high_vulns: z.number().int().nonnegative(),
    failed_checks: z.number().int().nonnegative(),
    pending_checks: z.number().int().nonnegative(),
    open_sev1: z.number().int().nonnegative(),
    open_incidents: z.number().int().nonnegative(),
    recent_incidents: z.number().int().nonnegative(),
    slo_breaches: z.number().int().nonnegative(),
    breaking_commits: z.number().int().nonnegative(),
    commit_count: z.number().int().nonnegative(),
    pr_count: z.number().int().nonnegative(),
  })
  .strict();

export type RiskCounts = z.infer<typeof RiskCountsSchema>;

export const BaselineSummarySchema = z
  .object({
    mode: z.enum(['all', 'new_only']),
    ref: z.string().max(256).nullable(),
    available: z.boolean(),
    matched_findings: z.number().int().nonnegative(),
    new_findings: z.number().int().nonnegative(),
    matched_incidents: z.number().int().nonnegative(),
    new_incidents: z.number().int().nonnegative(),
    checks_delta: z
      .object({
        failure: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        required_failed: z.number().int().nonnegative(),
      })
      .strict(),
    new_risk: RiskCountsSchema,
    source_errors: z.array(SourceErrorSchema).max(8),
  })
  .strict();

export type BaselineSummary = z.infer<typeof BaselineSummarySchema>;

export const ReleaseRiskReportSchema = z
  .object({
    target_ref: z.string().min(1).max(256),
    base_ref: z.string().max(256).nullable(),
    environment: z.enum(ENVIRONMENTS),
    commits: z.array(CommitSchema).max(500),
    prs: z.array(PullRequestSchema).max(200),
    checks: CheckSummarySchema,
    deployments: DeploymentSummarySchema,
    changelog: ChangelogInfoSchema,
    findings: z.array(FindingSchema).max(2000),
    incidents: z.array(IncidentSchema).max(200),
    metrics: z.array(MetricSchema).max(200),
    upstream_decisions: z.array(UpstreamDecisionSchema).max(8),
    baseline: BaselineSummarySchema,
    source_errors: z.array(SourceErrorSchema).max(32),
    risk: RiskCountsSchema,
  })
  .strict();

export type ReleaseRiskReport = z.infer<typeof ReleaseRiskReportSchema>;

export const OracleDecisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    confidence: z.number().min(0).max(1),
    reason_codes: z.array(z.enum(REASON_CODES)).min(1).max(24),
    risk_summary: RiskCountsSchema,
    baseline_summary: BaselineSummarySchema,
    recommended_checks: z.array(z.enum(RECOMMENDED_CHECKS)).max(8),
    summary: z.string().min(1).max(500),
    explanation: z.string().max(2000),
    provisional: z.boolean(),
    jev_status: z.enum(JEV_STATUSES),
    jev_proposed: z.enum(DECISIONS).nullable(),
    jev_error_code: z.string().max(64).nullable().optional(),
    policy_floor: z.enum(DECISIONS),
    held: z.boolean(),
    environment: z.enum(ENVIRONMENTS),
    target_ref: z.string().min(1).max(256),
    base_ref: z.string().max(256).nullable(),
  })
  .strict();

export type OracleDecision = z.infer<typeof OracleDecisionSchema>;

export const RunOptionsSchema = z
  .object({
    min_confidence: z.number().min(0).max(1).default(0.75),
    low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).default('fail'),
    review_mode: z.enum(REVIEW_MODES).default('fail'),
    fail_on_warn: z.boolean().default(false),
    source_error_policy: z.enum(SOURCE_ERROR_POLICIES).default('fail'),
    jev_provider: z.enum(JEV_PROVIDERS).default('vercel-ai-gateway'),
    timeout_ms: z.number().int().positive().default(45_000),
    max_items_to_jev: z.number().int().positive().max(200).default(40),
    comment_on_github: z.boolean().default(false),
    create_check_run: z.boolean().default(true),
    write_report_artifact: z.boolean().default(false),
    request_reviewers: z.string().max(500).optional(),
    structured_logs: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  })
  .strict();

export type RunOptions = z.infer<typeof RunOptionsSchema>;
