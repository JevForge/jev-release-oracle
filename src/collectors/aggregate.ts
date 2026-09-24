import type { EnvironmentName } from '../schemas/enums.js';
import {
  ReleaseRiskReportSchema,
  type ChangelogInfo,
  type CheckSummary,
  type CommitInfo,
  type DeploymentSummary,
  type Finding,
  type Incident,
  type Metric,
  type PullRequestInfo,
  type ReleaseRiskReport,
  type RiskCounts,
  type SourceError,
} from '../schemas/oracle.js';
import { emptyChecks, emptyDeployments, isBreakingCommitMessage } from './signals.js';

const LARGE_CHANGESET = 40;

export function computeRiskCounts(input: {
  commits: CommitInfo[];
  prs: PullRequestInfo[];
  checks: CheckSummary;
  findings: Finding[];
  incidents: Incident[];
  metrics: Metric[];
  breakingHint?: boolean;
}): RiskCounts {
  const breaking_commits =
    input.commits.filter(commit => commit.breaking || isBreakingCommitMessage(commit.message)).length +
    (input.breakingHint && input.commits.every(commit => !commit.breaking) ? 1 : 0);
  return {
    critical_vulns: input.findings.filter(finding => finding.severity === 'critical').length,
    high_vulns: input.findings.filter(finding => finding.severity === 'high').length,
    failed_checks: input.checks.failure + input.checks.required_failed,
    pending_checks: input.checks.pending,
    open_sev1: input.incidents.filter(
      incident => incident.status === 'open' && incident.severity === 'sev1',
    ).length,
    open_incidents: input.incidents.filter(incident => incident.status === 'open').length,
    recent_incidents: input.incidents.filter(
      incident => incident.status === 'mitigated' || incident.status === 'resolved',
    ).length,
    slo_breaches: input.metrics.filter(metric => metric.breached).length,
    breaking_commits,
    commit_count: input.commits.length,
    pr_count: input.prs.length,
  };
}

export function buildReleaseRiskReport(input: {
  target_ref: string;
  base_ref: string | null;
  environment: EnvironmentName;
  commits?: CommitInfo[];
  prs?: PullRequestInfo[];
  checks?: CheckSummary;
  deployments?: DeploymentSummary;
  changelog?: ChangelogInfo;
  findings?: Finding[];
  incidents?: Incident[];
  metrics?: Metric[];
  source_errors?: SourceError[];
  breakingHint?: boolean;
}): ReleaseRiskReport {
  const commits = input.commits ?? [];
  const prs = input.prs ?? [];
  const checks = input.checks ?? emptyChecks();
  const deployments = input.deployments ?? emptyDeployments();
  const changelog = input.changelog ?? { present: false, breaking_mentioned: false, path: null };
  const findings = input.findings ?? [];
  const incidents = input.incidents ?? [];
  const metrics = input.metrics ?? [];
  const risk = computeRiskCounts({
    commits,
    prs,
    checks,
    findings,
    incidents,
    metrics,
    breakingHint: input.breakingHint,
  });
  return ReleaseRiskReportSchema.parse({
    target_ref: input.target_ref,
    base_ref: input.base_ref,
    environment: input.environment,
    commits,
    prs,
    checks,
    deployments,
    changelog,
    findings,
    incidents,
    metrics,
    source_errors: (input.source_errors ?? []).slice(0, 32),
    risk,
  });
}

export function isLargeChangeset(report: ReleaseRiskReport): boolean {
  return report.risk.commit_count >= LARGE_CHANGESET || report.risk.pr_count >= 15;
}
