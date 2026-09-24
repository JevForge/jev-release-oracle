import { z } from 'zod';
import type { CheckSummary, Finding, Incident, ReleaseRiskReport, SourceError } from '../schemas/oracle.js';
import { CheckSummarySchema, FindingSchema, IncidentSchema } from '../schemas/oracle.js';

export interface BaselineSnapshot {
  target_ref?: string;
  findings?: Finding[];
  incidents?: Incident[];
  checks?: CheckSummary;
}

export interface BaselineInput {
  mode: 'all' | 'new_only';
  ref: string | null;
  snapshot?: BaselineSnapshot;
  error?: string;
}

const BaselineSnapshotSchema = z
  .object({
    target_ref: z.string().optional(),
    findings: z.array(FindingSchema).max(2000).optional(),
    incidents: z.array(IncidentSchema).max(200).optional(),
    checks: CheckSummarySchema.optional(),
  })
  .passthrough();

export function parseBaselineSnapshot(raw: unknown): BaselineSnapshot {
  const parsed = BaselineSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid baseline snapshot: ${parsed.error.message}`);
  return parsed.data;
}

function findingKey(finding: Finding): string {
  return [finding.id, finding.cve ?? '', finding.package ?? ''].join('|').toLowerCase();
}

function incidentKey(incident: Incident): string {
  return incident.id.toLowerCase();
}

function delta(current: number, previous: number | undefined): number {
  return Math.max(0, current - (previous ?? 0));
}

export function applyReleaseBaseline(report: ReleaseRiskReport, input: BaselineInput): ReleaseRiskReport {
  if (input.mode === 'all') return report;

  const sourceErrors: SourceError[] = input.error
    ? [{ source: 'baseline', message: input.error.slice(0, 500) }]
    : [];
  const snapshot = input.snapshot;
  if (!snapshot) {
    return {
      ...report,
      source_errors: [...report.source_errors, ...sourceErrors].slice(0, 32),
      baseline: {
        mode: 'new_only',
        ref: input.ref,
        available: false,
        matched_findings: 0,
        new_findings: report.findings.length,
        matched_incidents: 0,
        new_incidents: report.incidents.length,
        checks_delta: {
          failure: report.checks.failure,
          pending: report.checks.pending,
          required_failed: report.checks.required_failed,
        },
        new_risk: report.risk,
        source_errors: sourceErrors,
      },
    };
  }

  const knownFindings = new Set((snapshot.findings ?? []).map(findingKey));
  const knownIncidents = new Set((snapshot.incidents ?? []).map(incidentKey));
  const newFindings = report.findings.filter(finding => !knownFindings.has(findingKey(finding)));
  const newIncidents = report.incidents.filter(incident => !knownIncidents.has(incidentKey(incident)));
  const checksDelta = {
    failure: delta(report.checks.failure, snapshot.checks?.failure),
    pending: delta(report.checks.pending, snapshot.checks?.pending),
    required_failed: delta(report.checks.required_failed, snapshot.checks?.required_failed),
  };
  const newRisk = {
    ...report.risk,
    critical_vulns: newFindings.filter(finding => finding.severity === 'critical').length,
    high_vulns: newFindings.filter(finding => finding.severity === 'high').length,
    failed_checks: checksDelta.failure + checksDelta.required_failed,
    pending_checks: checksDelta.pending,
    open_sev1: newIncidents.filter(incident => incident.status === 'open' && incident.severity === 'sev1').length,
    open_incidents: newIncidents.filter(incident => incident.status === 'open').length,
    recent_incidents: newIncidents.filter(
      incident => incident.status === 'mitigated' || incident.status === 'resolved',
    ).length,
  };

  return {
    ...report,
    baseline: {
      mode: 'new_only',
      ref: input.ref,
      available: true,
      matched_findings: report.findings.length - newFindings.length,
      new_findings: newFindings.length,
      matched_incidents: report.incidents.length - newIncidents.length,
      new_incidents: newIncidents.length,
      checks_delta: checksDelta,
      new_risk: newRisk,
      source_errors: sourceErrors,
    },
  };
}
