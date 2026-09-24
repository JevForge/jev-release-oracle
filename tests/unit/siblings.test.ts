import { describe, expect, it } from 'vitest';
import { parseSiblingSignals } from '../../src/collectors/siblings.js';

describe('sibling action signals', () => {
  it('maps Security Sentinel decision and rich findings into Oracle evidence', () => {
    const parsed = parseSiblingSignals({
      sentinelDecision: JSON.stringify({ decision: 'BLOCK', jev_status: 'evaluated' }),
      sentinelFindings: JSON.stringify({
        findings: [
          {
            id: 'finding-1',
            fingerprint: 'fingerprint-12345678',
            severity: 'high',
            rule_id: 'js/sql-injection',
            cve: 'CVE-2026-0001',
            title: 'SQL injection',
            component: 'api',
          },
        ],
      }),
    });

    expect(parsed.decision).toBe('hold');
    expect(parsed.findings).toEqual([
      expect.objectContaining({
        id: 'finding-1',
        severity: 'high',
        title: 'SQL injection',
        package: 'api',
        cve: 'CVE-2026-0001',
      }),
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it('maps Cost Guardian outputs and metrics without requiring reserialization', () => {
    const parsed = parseSiblingSignals({
      costDecision: JSON.stringify({ decision: 'manual-review', utilization: 1.12, budget_remaining: -80 }),
      costMetrics: JSON.stringify({
        metrics: [{ name: 'monthly_cost', value: 1080, threshold: 1000, breached: true, unit: 'USD' }],
      }),
    });

    expect(parsed.decision).toBe('review');
    expect(parsed.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'monthly_cost', value: 1080, breached: true }),
      expect.objectContaining({ name: 'cost_utilization', value: 1.12, breached: true }),
      expect.objectContaining({ name: 'cost_budget_remaining', value: -80, breached: true }),
    ]));
  });

  it('preserves Cost Guardian findings as bounded cost metrics', () => {
    const parsed = parseSiblingSignals({
      costMetrics: JSON.stringify({
        findings: [{ id: 'aws-1', monthly_cost: 42, currency: 'USD' }],
      }),
    });
    expect(parsed.metrics).toContainEqual(expect.objectContaining({ name: 'cost:aws-1', value: 42, unit: 'USD' }));
  });

  it('reports malformed sibling output as a source error and continues', () => {
    const parsed = parseSiblingSignals({
      sentinelDecision: '{not-json',
      sentinelFindings: JSON.stringify({ findings: [{ id: 'ok', severity: 'low', title: 'ok' }] }),
    });

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ source: 'security-sentinel' }),
    ]);
  });

  it('does not silently ignore an unrecognized sibling decision', () => {
    const parsed = parseSiblingSignals({ sentinelDecision: 'ship-it' });
    expect(parsed.decision).toBeNull();
    expect(parsed.errors[0]?.message).toMatch(/Unrecognized/);
  });
});
