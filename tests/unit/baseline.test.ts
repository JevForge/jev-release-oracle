import { describe, expect, it } from 'vitest';
import { applyReleaseBaseline } from '../../src/collectors/baseline.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';
import { floorDecision } from '../../src/decision/policy.js';
import { parseBaselineSnapshot } from '../../src/collectors/baseline.js';

describe('release baselines', () => {
  it('keeps known findings, incidents, and check failures visible but gates only new risk', () => {
    const current = buildReleaseRiskReport({
      target_ref: 'v2.0.0',
      base_ref: 'v1.0.0',
      environment: 'production',
      findings: [
        { id: 'known-critical', severity: 'critical', title: 'known' },
        { id: 'new-high', severity: 'high', title: 'new' },
      ],
      incidents: [{ id: 'incident-1', severity: 'sev1', title: 'known outage', status: 'open' }],
      checks: { total: 1, success: 0, failure: 1, pending: 0, required_failed: 1, conclusions: ['failure'] },
    });
    const report = applyReleaseBaseline(current, {
      mode: 'new_only',
      ref: 'v1.0.0',
      snapshot: {
        findings: [{ id: 'known-critical', severity: 'critical', title: 'known' }],
        incidents: [{ id: 'incident-1', severity: 'sev1', title: 'known outage', status: 'open' }],
        checks: { total: 1, success: 0, failure: 1, pending: 0, required_failed: 1, conclusions: ['failure'] },
      },
    });

    expect(report.risk.critical_vulns).toBe(1);
    expect(report.baseline.matched_findings).toBe(1);
    expect(report.baseline.new_findings).toBe(1);
    expect(report.baseline.matched_incidents).toBe(1);
    expect(report.baseline.new_risk.critical_vulns).toBe(0);
    expect(report.baseline.new_risk.failed_checks).toBe(0);
    expect(floorDecision(report)).toBe('warn');
  });

  it('fails closed to current risk when new_only has no usable baseline', () => {
    const current = buildReleaseRiskReport({
      target_ref: 'v2.0.0',
      base_ref: null,
      environment: 'production',
      findings: [{ id: 'critical', severity: 'critical', title: 'rce' }],
    });
    const report = applyReleaseBaseline(current, {
      mode: 'new_only',
      ref: null,
      error: 'Baseline file not found',
    });

    expect(report.baseline.available).toBe(false);
    expect(report.baseline.source_errors).toEqual([{ source: 'baseline', message: 'Baseline file not found' }]);
    expect(floorDecision(report)).toBe('hold');
  });

  it('leaves all-mode reports unchanged and rejects malformed snapshots', () => {
    const current = buildReleaseRiskReport({ target_ref: 'v1', base_ref: null, environment: 'staging' });
    expect(applyReleaseBaseline(current, { mode: 'all', ref: null }).baseline.mode).toBe('all');
    expect(() => parseBaselineSnapshot({ findings: [{ id: 1 }] })).toThrow(/Invalid baseline snapshot/);
  });

  it('preserves a missing-baseline error on the report for source-error policy', () => {
    const current = buildReleaseRiskReport({ target_ref: 'v2', base_ref: null, environment: 'staging' });
    const report = applyReleaseBaseline(current, { mode: 'new_only', ref: null, error: 'baseline unavailable' });
    expect(report.source_errors).toContainEqual({ source: 'baseline', message: 'baseline unavailable' });
  });
});
