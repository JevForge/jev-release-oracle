import { describe, expect, it } from 'vitest';
import { OracleDecisionSchema } from '../../src/schemas/oracle.js';
import { DECISIONS, REASON_CODES, RECOMMENDED_CHECKS } from '../../src/schemas/enums.js';
import { applyOraclePolicy } from '../../src/decision/policy.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';
import { interpretEvaluation } from '../../src/jev/normalize.js';

const clean = buildReleaseRiskReport({
  target_ref: 'abc',
  base_ref: 'v1',
  environment: 'staging',
  checks: {
    total: 1,
    success: 1,
    failure: 0,
    pending: 0,
    required_failed: 0,
    conclusions: ['success'],
  },
});

describe('oracle decision schema', () => {
  it('accepts a complete decision from policy', () => {
    const outcome = applyOraclePolicy({
      report: clean,
      jev: {
        status: 'evaluated',
        decision: 'proceed',
        confidence: 0.88,
        explanation: 'ok',
        abstain: false,
      },
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      sourceErrorPolicy: 'warn',
      reviewMode: 'fail',
      failOnWarn: false,
    });
    const parsed = OracleDecisionSchema.parse(outcome.decision);
    expect(parsed.decision).toBe('proceed');
    expect(parsed.reason_codes.length).toBeGreaterThan(0);
    expect(parsed.held).toBe(false);
  });

  it.each([
    [{ decision: 'proceed', confidence: 1.2, reason_codes: ['ALL_CHECKS_GREEN'] }],
    [{ decision: 'ship-it', confidence: 0.9, reason_codes: ['ALL_CHECKS_GREEN'] }],
    [{ decision: 'proceed', confidence: 0.9, reason_codes: [] }],
    [{ decision: 'proceed', confidence: 0.9, reason_codes: ['DROP_ALL_RISK'] }],
    [
      {
        decision: 'hold',
        confidence: 0.4,
        reason_codes: ['CRITICAL_VULN'],
        shell: 'gh release create',
      },
    ],
  ])('rejects invalid payload %j', payload => {
    expect(OracleDecisionSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects out-of-contract Jev choices', () => {
    const rejected = interpretEvaluation({
      answers: { release_decision: { type: 'choice', choice: 'deploy-now' } },
    });
    expect(rejected.status).toBe('schema_rejected');
  });

  it('keeps recommended checks inside the allowlist', () => {
    const outcome = applyOraclePolicy({
      report: buildReleaseRiskReport({
        target_ref: 'abc',
        base_ref: null,
        environment: 'production',
        findings: [{ id: 'c', severity: 'critical', title: 'rce' }],
        checks: {
          total: 1,
          success: 0,
          failure: 1,
          pending: 0,
          required_failed: 1,
          conclusions: ['failure'],
        },
      }),
      jev: {
        status: 'evaluated',
        decision: 'hold',
        confidence: 0.9,
        explanation: 'hold',
        abstain: false,
      },
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      sourceErrorPolicy: 'fail',
      reviewMode: 'fail',
      failOnWarn: false,
    });
    for (const check of outcome.decision.recommended_checks) {
      expect(RECOMMENDED_CHECKS).toContain(check);
    }
    for (const code of outcome.decision.reason_codes) {
      expect(REASON_CODES).toContain(code);
    }
    expect(DECISIONS).toContain(outcome.decision.decision);
  });
});
