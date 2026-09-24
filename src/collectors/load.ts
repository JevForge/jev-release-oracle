import type { EnvironmentName } from '../schemas/enums.js';
import type { ReleaseRiskReport, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';
import { buildReleaseRiskReport } from './aggregate.js';
import { loadChangelog } from './changelog.js';
import { fetchChecks, type ChecksClient } from './checks.js';
import { fetchDeployments, type DeploymentsClient } from './deployments.js';
import { loadFindings } from './findings.js';
import { fetchGithubCompare, type CompareClient } from './github-compare.js';
import { filterIncidentsByLabels, loadIncidents } from './incidents.js';
import { loadMetrics } from './metrics.js';
import { parseSiblingSignals } from './siblings.js';
import { applyReleaseBaseline, parseBaselineSnapshot, type BaselineInput, type BaselineSnapshot } from './baseline.js';
import {
  emptyChecks,
  emptyDeployments,
  mergeCheckSummaries,
  mergeDeploySummaries,
  parseSignalsDocument,
} from './signals.js';

export interface LoadReportInput {
  workspace: string;
  targetRef: string;
  baseRef: string | null;
  environment: EnvironmentName;
  signalsJson?: string;
  signalsPath?: string;
  changelogPath?: string;
  findingsPath?: string;
  findingsJson?: string;
  sarifPath?: string;
  incidentsPath?: string;
  metricsPath?: string;
  metricsJson?: string;
  fetchGithubCompare?: boolean;
  fetchChecks?: boolean;
  fetchDeployments?: boolean;
  incidentLabels?: string[];
  owner?: string;
  repo?: string;
  compareClient?: CompareClient | null;
  checksClient?: ChecksClient | null;
  deploymentsClient?: DeploymentsClient | null;
  sentinelDecision?: string;
  sentinelFindings?: string;
  costDecision?: string;
  costMetrics?: string;
  baselinePath?: string;
  baselineMode?: 'all' | 'new_only';
  baselineSnapshot?: BaselineSnapshot;
  baselineRef?: string | null;
  baselineError?: string;
}

export async function loadReleaseReport(input: LoadReportInput): Promise<ReleaseRiskReport> {
  const errors: SourceError[] = [];
  let signalsRaw: unknown = null;

  if (input.signalsJson?.trim()) {
    try {
      signalsRaw = JSON.parse(input.signalsJson) as unknown;
    } catch (error) {
      errors.push({
        source: 'signals',
        message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
      });
    }
  } else if (input.signalsPath?.trim()) {
    const text = readWorkspaceText(input.workspace, input.signalsPath);
    if (text == null) {
      errors.push({
        source: 'signals',
        message: `Signals file not found: ${sanitizeText(input.signalsPath, 200)}`,
      });
    } else {
      try {
        signalsRaw = parseJsonOrYaml(text);
      } catch (error) {
        errors.push({
          source: 'signals',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        });
      }
    }
  }

  const signals = signalsRaw != null ? parseSignalsDocument(signalsRaw) : parseSignalsDocument({});
  errors.push(...signals.errors);

  const changelogResult = loadChangelog(input.workspace, input.changelogPath);
  errors.push(...changelogResult.errors);

  const findingsResult = loadFindings(input.workspace, input.findingsPath, input.sarifPath, input.findingsJson);
  errors.push(...findingsResult.errors);

  const incidentsResult = loadIncidents(input.workspace, input.incidentsPath);
  errors.push(...incidentsResult.errors);

  const metricsResult = loadMetrics(input.workspace, input.metricsPath, input.metricsJson);
  errors.push(...metricsResult.errors);

  const sibling = parseSiblingSignals({
    sentinelDecision: input.sentinelDecision,
    sentinelFindings: input.sentinelFindings,
    costDecision: input.costDecision,
    costMetrics: input.costMetrics,
  });
  errors.push(...sibling.errors);

  let commits = [...signals.commits];
  let prs = [...signals.prs];
  let checks = mergeCheckSummaries(emptyChecks(), signals.checks);
  let deployments = mergeDeploySummaries(emptyDeployments(), signals.deployments);

  if (signals.testsFailed > 0) {
    checks = mergeCheckSummaries(checks, {
      total: signals.testsFailed,
      failure: signals.testsFailed,
      required_failed: signals.testsFailed,
      conclusions: Array.from({ length: Math.min(signals.testsFailed, 16) }, () => 'failure' as const),
    });
  }
  if (signals.testsPending) {
    checks = mergeCheckSummaries(checks, {
      total: 1,
      pending: 1,
      conclusions: ['pending'],
    });
  }

  if (
    input.fetchGithubCompare &&
    input.baseRef &&
    input.compareClient &&
    input.owner &&
    input.repo
  ) {
    const compared = await fetchGithubCompare({
      client: input.compareClient,
      owner: input.owner,
      repo: input.repo,
      baseRef: input.baseRef,
      targetRef: input.targetRef,
    });
    errors.push(...compared.errors);
    if (compared.commits.length) commits = compared.commits;
    if (compared.prs.length) prs = compared.prs;
  }

  if (input.fetchChecks && input.checksClient && input.owner && input.repo) {
    const remoteChecks = await fetchChecks({
      client: input.checksClient,
      owner: input.owner,
      repo: input.repo,
      ref: input.targetRef,
    });
    errors.push(...remoteChecks.errors);
    checks = mergeCheckSummaries(checks, remoteChecks.checks);
  }

  if (input.fetchDeployments && input.deploymentsClient && input.owner && input.repo) {
    const remoteDeploys = await fetchDeployments({
      client: input.deploymentsClient,
      owner: input.owner,
      repo: input.repo,
      environment: input.environment,
    });
    errors.push(...remoteDeploys.errors);
    deployments = mergeDeploySummaries(deployments, remoteDeploys.deployments);
  }

  const changelog =
    input.changelogPath || changelogResult.changelog.present
      ? {
          present: changelogResult.changelog.present || Boolean(signals.changelog.present),
          breaking_mentioned:
            changelogResult.changelog.breaking_mentioned ||
            Boolean(signals.changelog.breaking_mentioned),
          path: changelogResult.changelog.path ?? signals.changelog.path ?? null,
        }
      : {
          present: Boolean(signals.changelog.present),
          breaking_mentioned: Boolean(signals.changelog.breaking_mentioned),
          path: signals.changelog.path ?? null,
        };

  const incidents = filterIncidentsByLabels(
    [...signals.incidents, ...incidentsResult.incidents],
    input.incidentLabels ?? [],
  );

  const report = buildReleaseRiskReport({
    target_ref: input.targetRef,
    base_ref: input.baseRef,
    environment: input.environment,
    commits,
    prs,
    checks,
    deployments,
    changelog,
    findings: [...signals.findings, ...findingsResult.findings, ...sibling.findings],
    incidents,
    metrics: [...signals.metrics, ...metricsResult.metrics, ...sibling.metrics],
    upstream_decisions: sibling.decisions,
    source_errors: errors,
    breakingHint: signals.breakingChange,
  });

  const baselineMode = input.baselineMode ?? 'all';
  if (baselineMode === 'all') return report;

  let baseline: BaselineInput = {
    mode: baselineMode,
    ref: input.baselinePath ?? input.baselineRef ?? null,
    snapshot: input.baselineSnapshot,
    error: input.baselineError ?? (input.baselinePath || input.baselineSnapshot ? undefined : 'baseline_mode=new_only requires a baseline'),
  };
  if (input.baselinePath) {
    const text = readWorkspaceText(input.workspace, input.baselinePath);
    if (text == null) {
      baseline.error = `Baseline file not found: ${sanitizeText(input.baselinePath, 200)}`;
    } else {
      try {
        baseline.snapshot = parseBaselineSnapshot(parseJsonOrYaml(text));
      } catch (error) {
        baseline.error = sanitizeText(error instanceof Error ? error.message : String(error), 500);
      }
    }
  }
  return applyReleaseBaseline(report, baseline);
}
