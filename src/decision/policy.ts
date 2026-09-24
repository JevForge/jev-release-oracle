import {
  DECISION_RANK,
  RECOMMENDED_CHECKS,
  type Decision,
  type LowConfidencePolicy,
  type ReasonCode,
  type RecommendedCheck,
  type ReviewMode,
  type SourceErrorPolicy,
} from '../schemas/enums.js';
import {
  OracleDecisionSchema,
  type OracleDecision,
  type ReleaseRiskReport,
} from '../schemas/oracle.js';
import type { JevCallResult } from '../jev/types.js';
import { isLargeChangeset } from '../collectors/aggregate.js';
import { sanitizeText } from '../utils/redact.js';

export type ActionStatus = 'ok' | 'fail' | 'warn' | 'request-review' | 'no-op';

export function stricter(left: Decision, right: Decision): Decision {
  return DECISION_RANK[left] >= DECISION_RANK[right] ? left : right;
}

export function floorDecision(report: ReleaseRiskReport): Decision {
  let floor: Decision = 'proceed';
  const { risk, deployments, changelog } = report;

  if (
    risk.critical_vulns > 0 ||
    risk.open_sev1 > 0 ||
    risk.failed_checks > 0 ||
    deployments.failure > 0 ||
    deployments.latest_state === 'failure' ||
    deployments.latest_state === 'error'
  ) {
    floor = stricter(floor, 'hold');
  }

  const breaking = risk.breaking_commits > 0 || changelog.breaking_mentioned;
  if (breaking && !changelog.present) {
    floor = stricter(floor, 'review');
  }

  const warnSignals =
    risk.slo_breaches > 0 ||
    risk.high_vulns > 0 ||
    risk.failed_checks > 0 ||
    risk.open_incidents > 0 ||
    isLargeChangeset(report);

  if (warnSignals) {
    if (
      report.environment === 'production' &&
      (risk.critical_vulns > 0 || risk.open_sev1 > 0 || risk.slo_breaches > 0)
    ) {
      floor = stricter(floor, 'hold');
    } else {
      floor = stricter(floor, 'warn');
    }
  }

  return floor;
}

function pushCode(codes: ReasonCode[], code: ReasonCode): void {
  if (!codes.includes(code) && codes.length < 24) codes.push(code);
}

function recommendChecks(report: ReleaseRiskReport, decision: Decision): RecommendedCheck[] {
  const checks: RecommendedCheck[] = [];
  const add = (check: RecommendedCheck) => {
    if (!checks.includes(check) && (RECOMMENDED_CHECKS as readonly string[]).includes(check)) {
      checks.push(check);
    }
  };
  if (report.risk.failed_checks > 0 || report.checks.failure > 0) add('rerun-failed-tests');
  if (report.risk.critical_vulns > 0 || report.risk.high_vulns > 0) add('security-review');
  if (report.risk.breaking_commits > 0 && !report.changelog.present) add('changelog-review');
  if (report.risk.open_incidents > 0 || report.risk.open_sev1 > 0) add('incident-review');
  if (report.risk.slo_breaches > 0) add('slo-review');
  if (decision === 'review' || decision === 'hold') {
    add('manual-qa');
    add('rollback-plan');
  }
  if (report.environment === 'production' && (decision === 'warn' || decision === 'review')) {
    add('canary-first');
  }
  return checks.slice(0, 8);
}

function buildReasons(input: {
  report: ReleaseRiskReport;
  floor: Decision;
  proposed: Decision | null;
  finalDecision: Decision;
  jev: JevCallResult;
  lowConfidence: boolean;
}): ReasonCode[] {
  const codes: ReasonCode[] = [];
  const { report, floor } = input;
  const hasSignals =
    report.commits.length > 0 ||
    report.findings.length > 0 ||
    report.incidents.length > 0 ||
    report.metrics.length > 0 ||
    report.checks.total > 0 ||
    report.deployments.total > 0 ||
    report.changelog.present;

  if (!hasSignals) pushCode(codes, 'NO_SIGNALS');
  if (report.checks.total > 0 && report.checks.failure === 0 && report.checks.pending === 0) {
    pushCode(codes, 'ALL_CHECKS_GREEN');
  }
  if (report.risk.failed_checks > 0 || report.checks.failure > 0) pushCode(codes, 'TESTS_FAILED');
  if (report.risk.pending_checks > 0 || report.checks.pending > 0) pushCode(codes, 'CHECKS_PENDING');
  if (report.risk.critical_vulns > 0) pushCode(codes, 'CRITICAL_VULN');
  if (report.risk.high_vulns > 0) pushCode(codes, 'HIGH_VULN');
  if (report.risk.breaking_commits > 0 || report.changelog.breaking_mentioned) {
    pushCode(codes, 'BREAKING_CHANGE');
  }
  if (report.risk.breaking_commits > 0 && !report.changelog.present) {
    pushCode(codes, 'CHANGELOG_MISSING');
  } else if (report.changelog.present) {
    pushCode(codes, 'CHANGELOG_OK');
  }
  if (report.risk.open_sev1 > 0 || report.risk.open_incidents > 0) pushCode(codes, 'OPEN_INCIDENT');
  if (report.risk.recent_incidents > 0) pushCode(codes, 'RECENT_INCIDENT');
  if (report.risk.slo_breaches > 0) pushCode(codes, 'SLO_BREACH');
  else if (report.metrics.length > 0) pushCode(codes, 'METRICS_OK');
  if (isLargeChangeset(report)) pushCode(codes, 'LARGE_CHANGESET');
  if (report.deployments.failure > 0 || report.deployments.latest_state === 'failure') {
    pushCode(codes, 'DEPLOY_FAILED');
  }
  if (report.deployments.pending > 0 || report.deployments.latest_state === 'pending') {
    pushCode(codes, 'DEPLOY_PENDING');
  }
  if (floor === 'hold') pushCode(codes, 'POLICY_FLOOR_HOLD');
  if (floor === 'warn') pushCode(codes, 'POLICY_FLOOR_WARN');
  if (floor === 'review') pushCode(codes, 'POLICY_FLOOR_REVIEW');
  if (input.jev.status === 'unavailable') pushCode(codes, 'JEV_UNAVAILABLE');
  if (input.jev.status === 'schema_rejected') pushCode(codes, 'SCHEMA_REJECTED');
  if (input.jev.status === 'evaluated' && input.jev.abstain) pushCode(codes, 'JEV_ABSTAIN');
  if (input.lowConfidence) pushCode(codes, 'LOW_CONFIDENCE');
  if (
    input.proposed &&
    DECISION_RANK[input.finalDecision] > DECISION_RANK[input.floor] &&
    DECISION_RANK[input.proposed] > DECISION_RANK[input.floor]
  ) {
    pushCode(codes, 'JEV_ESCALATED');
  } else if (
    input.proposed &&
    input.finalDecision === input.proposed &&
    input.finalDecision === input.floor
  ) {
    pushCode(codes, 'JEV_AGREED');
  }
  if (report.source_errors.length) pushCode(codes, 'SOURCE_UNAVAILABLE');
  const recommended = recommendChecks(report, input.finalDecision);
  if (recommended.length) pushCode(codes, 'RECOMMENDED_CHECKS');
  if (codes.length === 0) pushCode(codes, 'NO_SIGNALS');
  return codes;
}

function buildSummary(decision: Decision, report: ReleaseRiskReport, confidence: number): string {
  return sanitizeText(
    `${decision}: env=${report.environment} critical=${report.risk.critical_vulns} high=${report.risk.high_vulns} failed_checks=${report.risk.failed_checks} open_sev1=${report.risk.open_sev1} confidence=${confidence.toFixed(3)}`,
    500,
  );
}

export interface ApplyOracleInput {
  report: ReleaseRiskReport;
  jev: JevCallResult;
  minConfidence: number;
  lowConfidencePolicy: LowConfidencePolicy;
  sourceErrorPolicy: SourceErrorPolicy;
  reviewMode: ReviewMode;
  failOnWarn: boolean;
}

export interface OracleOutcome {
  decision: OracleDecision;
  status: ActionStatus;
  message: string;
}

export function applyOraclePolicy(input: ApplyOracleInput): OracleOutcome {
  const floor = floorDecision(input.report);
  const lowConfidence =
    input.jev.status === 'evaluated' && input.jev.confidence < input.minConfidence;
  let proposed: Decision | null = null;
  let confidence = 0;
  let provisional = input.jev.status !== 'evaluated';
  let explanation = '';

  if (input.jev.status === 'evaluated') {
    proposed = input.jev.abstain ? 'review' : input.jev.decision;
    confidence = input.jev.confidence;
    explanation = sanitizeText(input.jev.explanation, 2000);
  } else {
    confidence = 0;
    explanation = sanitizeText(input.jev.message, 2000);
  }

  let decision = floor;
  if (input.jev.status !== 'evaluated') {
    if (input.lowConfidencePolicy === 'warn') decision = stricter(floor, 'warn');
    else if (
      input.lowConfidencePolicy === 'request-review' ||
      input.lowConfidencePolicy === 'fail'
    ) {
      decision = stricter(floor, 'review');
    }
    // no-op keeps the floor (never fakes proceed above evidence)
  } else if (lowConfidence) {
    provisional = true;
    if (input.lowConfidencePolicy === 'no-op') decision = floor;
    else if (input.lowConfidencePolicy === 'warn') {
      decision = stricter(floor, proposed ?? floor);
      if (decision === 'proceed') decision = 'warn';
    } else {
      decision = stricter(stricter(floor, proposed ?? 'proceed'), 'review');
    }
  } else {
    decision = stricter(floor, proposed ?? floor);
  }

  if (input.report.source_errors.length && input.sourceErrorPolicy === 'fail') {
    decision = stricter(decision, 'review');
  }

  // Low-confidence warn must never leave a proceed standing as if Jev approved it.
  if (lowConfidence && input.lowConfidencePolicy === 'warn' && decision === 'proceed') {
    decision = 'warn';
  }

  const reasonCodes = buildReasons({
    report: input.report,
    floor,
    proposed: input.jev.status === 'evaluated' ? proposed : null,
    finalDecision: decision,
    jev: input.jev,
    lowConfidence,
  });

  const recommended = recommendChecks(input.report, decision);
  const record = OracleDecisionSchema.parse({
    decision,
    confidence,
    reason_codes: reasonCodes,
    risk_summary: input.report.risk,
    recommended_checks: recommended,
    summary: buildSummary(decision, input.report, confidence),
    explanation:
      explanation ||
      sanitizeText(`Release oracle decided ${decision} with floor ${floor}.`, 2000),
    provisional,
    jev_status: input.jev.status,
    jev_proposed: input.jev.status === 'evaluated' ? proposed : null,
    policy_floor: floor,
    held: decision === 'hold',
    environment: input.report.environment,
    target_ref: input.report.target_ref,
    base_ref: input.report.base_ref,
  });

  const jevFailedClosed =
    (input.jev.status !== 'evaluated' || lowConfidence) && input.lowConfidencePolicy === 'fail';
  let status: ActionStatus = 'ok';
  if (record.decision === 'hold' || jevFailedClosed) status = 'fail';
  else if (record.decision === 'review') {
    status = input.reviewMode === 'fail' ? 'fail' : 'request-review';
  } else if (
    record.decision === 'warn' ||
    (input.report.source_errors.length && input.sourceErrorPolicy === 'warn')
  ) {
    status = input.failOnWarn ? 'fail' : 'warn';
  } else if (input.jev.status !== 'evaluated' && input.lowConfidencePolicy === 'no-op') {
    status = 'no-op';
  }

  const message =
    status === 'fail'
      ? record.decision === 'hold'
        ? `Release held (${record.reason_codes.slice(0, 6).join(', ')})`
        : record.explanation || 'Release oracle requires attention'
      : record.explanation || record.decision;

  return { decision: record, status, message };
}
