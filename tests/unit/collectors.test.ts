import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadReleaseReport } from '../../src/collectors/load.js';
import { parseChangelogText } from '../../src/collectors/changelog.js';
import { parseSignalsDocument } from '../../src/collectors/signals.js';
import { buildReleaseRiskReport, computeRiskCounts } from '../../src/collectors/aggregate.js';

describe('collectors', () => {
  it('parses signal documents and derives risk counts', () => {
    const signals = parseSignalsDocument({
      commits: [{ sha: 'abc', message: 'feat!: break', breaking: true }],
      findings: [{ id: 'c1', severity: 'critical', title: 'rce' }],
      incidents: [{ id: 'i1', severity: 'sev1', title: 'down', status: 'open' }],
      metrics: [{ name: 'latency', value: 900, threshold: 300, breached: true }],
      tests_failed: 2,
      breaking_change: true,
    });
    expect(signals.commits[0]?.breaking).toBe(true);
    expect(signals.testsFailed).toBe(2);

    const report = buildReleaseRiskReport({
      target_ref: 'head',
      base_ref: 'base',
      environment: 'staging',
      commits: signals.commits,
      findings: signals.findings,
      incidents: signals.incidents,
      metrics: signals.metrics,
      checks: {
        total: 2,
        success: 0,
        failure: 2,
        pending: 0,
        required_failed: 2,
        conclusions: ['failure', 'failure'],
      },
      breakingHint: true,
    });
    expect(report.risk.critical_vulns).toBe(1);
    expect(report.risk.open_sev1).toBe(1);
    expect(report.risk.slo_breaches).toBe(1);
    expect(report.risk.breaking_commits).toBeGreaterThan(0);
  });

  it('detects breaking mentions in changelogs', () => {
    expect(parseChangelogText('## 2.0.0\n\nBreaking change: removed API').breaking_mentioned).toBe(true);
    expect(parseChangelogText('## 1.1.0\n\n- fix typo').breaking_mentioned).toBe(false);
  });

  it('loads workspace signal files into a release report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-'));
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(
      join(root, 'data', 'signals.json'),
      JSON.stringify({
        checks: { total: 1, success: 1, failure: 0, pending: 0, required_failed: 0, conclusions: ['success'] },
        findings: [{ id: 'h1', severity: 'high', title: 'xss' }],
      }),
    );
    writeFileSync(
      join(root, 'data', 'metrics.json'),
      JSON.stringify({ metrics: [{ name: 'availability', value: 99.9, threshold: 99.5, breached: false }] }),
    );
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n### Fixed\n- bugs\n');

    const report = await loadReleaseReport({
      workspace: root,
      targetRef: 'abc',
      baseRef: 'def',
      environment: 'production',
      signalsPath: 'data/signals.json',
      metricsPath: 'data/metrics.json',
      changelogPath: 'CHANGELOG.md',
      fetchGithubCompare: false,
      fetchChecks: false,
      fetchDeployments: false,
    });

    expect(report.findings).toHaveLength(1);
    expect(report.metrics[0]?.breached).toBe(false);
    expect(report.changelog.present).toBe(true);
    expect(report.risk.high_vulns).toBe(1);
    expect(computeRiskCounts({
      commits: report.commits,
      prs: report.prs,
      checks: report.checks,
      findings: report.findings,
      incidents: report.incidents,
      metrics: report.metrics,
    }).high_vulns).toBe(1);
  });

  it('records source errors for missing paths without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-missing-'));
    const report = await loadReleaseReport({
      workspace: root,
      targetRef: 'abc',
      baseRef: null,
      environment: 'development',
      findingsPath: 'missing-findings.json',
      fetchGithubCompare: false,
      fetchChecks: false,
      fetchDeployments: false,
    });
    expect(report.source_errors.some(error => error.source === 'findings')).toBe(true);
  });

  it('accepts sibling Action outputs directly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-siblings-'));
    const report = await loadReleaseReport({
      workspace: root,
      targetRef: 'abc',
      baseRef: null,
      environment: 'production',
      fetchGithubCompare: false,
      fetchChecks: false,
      fetchDeployments: false,
      sentinelDecision: JSON.stringify({ decision: 'BLOCK' }),
      sentinelFindings: JSON.stringify({ findings: [{ id: 's1', severity: 'critical', title: 'rce' }] }),
      costMetrics: JSON.stringify({ utilization: 1.1 }),
    });

    expect(report.upstream_decisions).toEqual([
      { source: 'security-sentinel', decision: 'hold' },
    ]);
    expect(report.findings[0]?.severity).toBe('critical');
    expect(report.metrics.some(metric => metric.name === 'cost_utilization')).toBe(true);
  });

  it('loads an explicit release report baseline in new_only mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-baseline-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(
      join(root, '.jev', 'baseline.json'),
      JSON.stringify({
        findings: [{ id: 'known', severity: 'critical', title: 'known' }],
        incidents: [],
        checks: { total: 1, success: 0, failure: 1, pending: 0, required_failed: 1, conclusions: ['failure'] },
      }),
    );
    const report = await loadReleaseReport({
      workspace: root,
      targetRef: 'v2',
      baseRef: 'v1',
      environment: 'production',
      findingsPath: 'findings.json',
      baselinePath: '.jev/baseline.json',
      baselineMode: 'new_only',
      fetchGithubCompare: false,
      fetchChecks: false,
      fetchDeployments: false,
    });

    expect(report.baseline.available).toBe(true);
    expect(report.baseline.matched_findings).toBe(0);
    expect(report.baseline.checks_delta.failure).toBe(0);
  });
});
