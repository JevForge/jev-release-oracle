import { describe, expect, it } from 'vitest';
import { applyOraclePolicy, floorDecision, stricter } from '../../src/decision/policy.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';
import { planEffects } from '../../src/executors/effects.js';
import type { ReleaseRiskReport } from '../../src/schemas/oracle.js';

function report(overrides: Partial<Parameters<typeof buildReleaseRiskReport>[0]> = {}): ReleaseRiskReport {
  return buildReleaseRiskReport({
    target_ref: 'abc123',
    base_ref: 'v1.0.0',
    environment: 'production',
    ...overrides,
  });
}

const defaults = {
  minConfidence: 0.75,
  lowConfidencePolicy: 'fail' as const,
  sourceErrorPolicy: 'fail' as const,
  reviewMode: 'fail' as const,
  failOnWarn: false,
};

describe('deterministic release policy', () => {
  it('ranks escalate-only', () => {
    expect(stricter('proceed', 'warn')).toBe('warn');
    expect(stricter('warn', 'review')).toBe('review');
    expect(stricter('review', 'hold')).toBe('hold');
    expect(stricter('hold', 'proceed')).toBe('hold');
  });

  it('holds on critical vulns, open sev1, failed checks, or deploy failure', () => {
    expect(
      floorDecision(
        report({
          findings: [{ id: 'cve-1', severity: 'critical', title: 'RCE' }],
        }),
      ),
    ).toBe('hold');
    expect(
      floorDecision(
        report({
          incidents: [{ id: '1', severity: 'sev1', title: 'outage', status: 'open' }],
        }),
      ),
    ).toBe('hold');
    expect(
      floorDecision(
        report({
          checks: {
            total: 2,
            success: 1,
            failure: 1,
            pending: 0,
            required_failed: 1,
            conclusions: ['success', 'failure'],
          },
        }),
      ),
    ).toBe('hold');
    expect(
      floorDecision(
        report({
          deployments: { total: 1, success: 0, failure: 1, pending: 0, latest_state: 'failure' },
        }),
      ),
    ).toBe('hold');
  });

  it('reviews breaking changes without a changelog', () => {
    expect(
      floorDecision(
        report({
          commits: [{ sha: '1', message: 'feat!: drop API', breaking: true }],
          changelog: { present: false, breaking_mentioned: false, path: null },
        }),
      ),
    ).toBe('review');
  });

  it('warns on high vulns or SLO breach, and holds production critical SLO', () => {
    expect(
      floorDecision(
        report({
          findings: [{ id: 'h1', severity: 'high', title: 'xss' }],
        }),
      ),
    ).toBe('warn');
    expect(
      floorDecision(
        report({
          metrics: [{ name: 'error_rate', value: 5, threshold: 1, breached: true }],
        }),
      ),
    ).toBe('hold');
  });

  it('lets Jev escalate but never loosen the floor', () => {
    const base = report({
      findings: [{ id: 'h1', severity: 'high', title: 'xss' }],
    });
    const escalated = applyOraclePolicy({
      report: base,
      jev: {
        status: 'evaluated',
        decision: 'hold',
        confidence: 0.9,
        explanation: 'escalate',
        abstain: false,
      },
      ...defaults,
    });
    expect(escalated.decision.decision).toBe('hold');
    expect(escalated.decision.reason_codes).toContain('JEV_ESCALATED');
    expect(escalated.status).toBe('fail');

    const loosened = applyOraclePolicy({
      report: base,
      jev: {
        status: 'evaluated',
        decision: 'proceed',
        confidence: 0.95,
        explanation: 'ok',
        abstain: false,
      },
      ...defaults,
    });
    expect(loosened.decision.decision).toBe('warn');
    expect(loosened.decision.policy_floor).toBe('warn');
  });

  it('never fakes proceed on low confidence or unavailable Jev', () => {
    const clean = report({
      checks: {
        total: 1,
        success: 1,
        failure: 0,
        pending: 0,
        required_failed: 0,
        conclusions: ['success'],
      },
    });
    const low = applyOraclePolicy({
      report: clean,
      jev: {
        status: 'evaluated',
        decision: 'proceed',
        confidence: 0.2,
        explanation: 'unsure',
        abstain: false,
      },
      ...defaults,
    });
    expect(low.decision.decision).not.toBe('proceed');
    expect(low.decision.reason_codes).toContain('LOW_CONFIDENCE');
    expect(low.status).toBe('fail');

    const unavailable = applyOraclePolicy({
      report: clean,
      jev: { status: 'unavailable', message: 'timeout' },
      ...defaults,
    });
    expect(unavailable.decision.decision).toBe('review');
    expect(unavailable.decision.provisional).toBe(true);
    expect(unavailable.status).toBe('fail');

    const noop = applyOraclePolicy({
      report: clean,
      jev: { status: 'unavailable', message: 'timeout' },
      ...defaults,
      lowConfidencePolicy: 'no-op',
    });
    expect(noop.status).toBe('no-op');
    expect(noop.decision.provisional).toBe(true);
    expect(noop.decision.decision).toBe('proceed'); // evidence floor only; status stays no-op
  });

  it('raises incomplete sources to at least review when source_error_policy=fail', () => {
    const outcome = applyOraclePolicy({
      report: report({
        source_errors: [{ source: 'checks', message: 'API down' }],
      }),
      jev: {
        status: 'evaluated',
        decision: 'proceed',
        confidence: 0.9,
        explanation: 'ok',
        abstain: false,
      },
      ...defaults,
    });
    expect(outcome.decision.decision).toBe('review');
    expect(outcome.decision.reason_codes).toContain('SOURCE_UNAVAILABLE');
  });

  it('holds always fail; review respects review_mode; fail_on_warn optional', () => {
    const hold = applyOraclePolicy({
      report: report({
        findings: [{ id: 'c', severity: 'critical', title: 'rce' }],
      }),
      jev: {
        status: 'evaluated',
        decision: 'hold',
        confidence: 0.9,
        explanation: 'hold',
        abstain: false,
      },
      ...defaults,
    });
    expect(hold.status).toBe('fail');

    const reviewContinue = applyOraclePolicy({
      report: report({
        commits: [{ sha: '1', message: 'feat!: x', breaking: true }],
        changelog: { present: false, breaking_mentioned: false, path: null },
      }),
      jev: {
        status: 'evaluated',
        decision: 'review',
        confidence: 0.9,
        explanation: 'review',
        abstain: false,
      },
      ...defaults,
      reviewMode: 'continue',
    });
    expect(reviewContinue.decision.decision).toBe('review');
    expect(reviewContinue.status).toBe('request-review');

    const warnFail = applyOraclePolicy({
      report: report({
        findings: [{ id: 'h', severity: 'high', title: 'xss' }],
      }),
      jev: {
        status: 'evaluated',
        decision: 'warn',
        confidence: 0.9,
        explanation: 'warn',
        abstain: false,
      },
      ...defaults,
      failOnWarn: true,
    });
    expect(warnFail.status).toBe('fail');
  });

  it('limits effects to the allowlist and never includes publish/deploy', () => {
    const outcome = applyOraclePolicy({
      report: report({
        findings: [{ id: 'h', severity: 'high', title: 'xss' }],
      }),
      jev: {
        status: 'evaluated',
        decision: 'warn',
        confidence: 0.9,
        explanation: 'warn',
        abstain: false,
      },
      ...defaults,
    });
    const planned = planEffects({
      decision: outcome.decision,
      actionStatus: outcome.status,
      comment: true,
      checkRun: true,
      writeReport: true,
      requestReviewers: false,
    });
    expect(planned.effects.every(effect => !effect.includes('deploy') && !effect.includes('publish'))).toBe(
      true,
    );
    expect(planned.effects).toEqual(
      expect.arrayContaining(['set-outputs', 'warn-step', 'pull-request-comment', 'check-run', 'write-report']),
    );
  });
});
