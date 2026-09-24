import { z } from 'zod';
import {
  CHECK_CONCLUSIONS,
  DEPLOY_STATES,
  FINDING_SEVERITIES,
  INCIDENT_SEVERITIES,
} from '../schemas/enums.js';
import {
  ChangelogInfoSchema,
  CheckSummarySchema,
  CommitSchema,
  DeploymentSummarySchema,
  FindingSchema,
  IncidentSchema,
  MetricSchema,
  PullRequestSchema,
  type ChangelogInfo,
  type CheckSummary,
  type CommitInfo,
  type DeploymentSummary,
  type Finding,
  type Incident,
  type Metric,
  type PullRequestInfo,
  type SourceError,
} from '../schemas/oracle.js';
import { sanitizeText } from '../utils/redact.js';

const SignalsDocumentSchema = z
  .object({
    commits: z.array(CommitSchema).max(500).optional(),
    prs: z.array(PullRequestSchema).max(200).optional(),
    checks: CheckSummarySchema.partial().optional(),
    deployments: DeploymentSummarySchema.partial().optional(),
    changelog: ChangelogInfoSchema.partial().optional(),
    findings: z.array(FindingSchema).max(2000).optional(),
    incidents: z.array(IncidentSchema).max(200).optional(),
    metrics: z.array(MetricSchema).max(200).optional(),
    breaking_change: z.boolean().optional(),
    tests_failed: z.number().int().nonnegative().optional(),
    tests_pending: z.boolean().optional(),
  })
  .passthrough();

export interface ParsedSignals {
  commits: CommitInfo[];
  prs: PullRequestInfo[];
  checks: Partial<CheckSummary>;
  deployments: Partial<DeploymentSummary>;
  changelog: Partial<ChangelogInfo>;
  findings: Finding[];
  incidents: Incident[];
  metrics: Metric[];
  breakingChange: boolean;
  testsFailed: number;
  testsPending: boolean;
  errors: SourceError[];
}

export function emptyChecks(): CheckSummary {
  return {
    total: 0,
    success: 0,
    failure: 0,
    pending: 0,
    required_failed: 0,
    conclusions: [],
  };
}

export function emptyDeployments(): DeploymentSummary {
  return {
    total: 0,
    success: 0,
    failure: 0,
    pending: 0,
    latest_state: 'unknown',
  };
}

export function parseSignalsDocument(raw: unknown): ParsedSignals {
  const errors: SourceError[] = [];
  const parsed = SignalsDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    errors.push({
      source: 'signals',
      message: sanitizeText(`Invalid signals document: ${parsed.error.message}`, 400),
    });
    return {
      commits: [],
      prs: [],
      checks: {},
      deployments: {},
      changelog: {},
      findings: [],
      incidents: [],
      metrics: [],
      breakingChange: false,
      testsFailed: 0,
      testsPending: false,
      errors,
    };
  }
  const data = parsed.data;
  return {
    commits: data.commits ?? [],
    prs: data.prs ?? [],
    checks: data.checks ?? {},
    deployments: data.deployments ?? {},
    changelog: data.changelog ?? {},
    findings: data.findings ?? [],
    incidents: data.incidents ?? [],
    metrics: data.metrics ?? [],
    breakingChange: Boolean(data.breaking_change),
    testsFailed: data.tests_failed ?? 0,
    testsPending: Boolean(data.tests_pending),
    errors,
  };
}

export function mergeCheckSummaries(...parts: Array<Partial<CheckSummary> | undefined>): CheckSummary {
  const base = emptyChecks();
  const conclusions: CheckSummary['conclusions'] = [];
  for (const part of parts) {
    if (!part) continue;
    base.total += part.total ?? 0;
    base.success += part.success ?? 0;
    base.failure += part.failure ?? 0;
    base.pending += part.pending ?? 0;
    base.required_failed += part.required_failed ?? 0;
    for (const conclusion of part.conclusions ?? []) {
      if ((CHECK_CONCLUSIONS as readonly string[]).includes(conclusion)) {
        conclusions.push(conclusion);
      }
    }
  }
  base.conclusions = conclusions.slice(0, 64);
  return base;
}

export function mergeDeploySummaries(
  ...parts: Array<Partial<DeploymentSummary> | undefined>
): DeploymentSummary {
  const base = emptyDeployments();
  for (const part of parts) {
    if (!part) continue;
    base.total += part.total ?? 0;
    base.success += part.success ?? 0;
    base.failure += part.failure ?? 0;
    base.pending += part.pending ?? 0;
    if (part.latest_state && (DEPLOY_STATES as readonly string[]).includes(part.latest_state)) {
      base.latest_state = part.latest_state;
    }
  }
  return base;
}

export function isBreakingCommitMessage(message: string): boolean {
  return /breaking[\s-]?change|!:/i.test(message) || /^[^:\n]+!:/m.test(message);
}

export function normalizeSeverity(value: unknown): Finding['severity'] {
  const raw = typeof value === 'string' ? value.toLowerCase() : 'unknown';
  if ((FINDING_SEVERITIES as readonly string[]).includes(raw)) {
    return raw as Finding['severity'];
  }
  if (raw === 'error') return 'high';
  if (raw === 'warning') return 'medium';
  if (raw === 'note') return 'low';
  return 'unknown';
}

export function normalizeIncidentSeverity(value: unknown): Incident['severity'] {
  const raw = typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '') : 'unknown';
  if ((INCIDENT_SEVERITIES as readonly string[]).includes(raw)) {
    return raw as Incident['severity'];
  }
  if (raw.includes('1') || raw.includes('critical')) return 'sev1';
  if (raw.includes('2') || raw.includes('high')) return 'sev2';
  if (raw.includes('3')) return 'sev3';
  if (raw.includes('4')) return 'sev4';
  return 'unknown';
}
