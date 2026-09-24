import { describe, expect, it } from 'vitest';
import { runOracle } from '../../src/run.js';
import type { JevProvider } from '../../src/jev/types.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';

const clean = buildReleaseRiskReport({
  target_ref: 'deadbeef',
  base_ref: 'v1.0.0',
  environment: 'staging',
  checks: {
    total: 2,
    success: 2,
    failure: 0,
    pending: 0,
    required_failed: 0,
    conclusions: ['success', 'success'],
  },
  changelog: { present: true, breaking_mentioned: false, path: 'CHANGELOG.md' },
});

function provider(decision: 'proceed' | 'warn' | 'hold' | 'review', confidence = 0.92): JevProvider {
  return {
    id: 'custom-compatible',
    async evaluateRelease() {
      return {
        status: 'evaluated',
        decision,
        confidence,
        explanation: `mock ${decision}`,
        abstain: false,
      };
    },
  };
}

describe('runOracle', () => {
  it('returns the Jev decision when the floor allows it', async () => {
    const result = await runOracle({
      report: clean,
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      reviewMode: 'fail',
      failOnWarn: false,
      sourceErrorPolicy: 'warn',
      jevProvider: 'custom-compatible',
      timeoutMs: 1000,
      maxItemsToJev: 40,
      commentOnGithub: false,
      createCheckRun: false,
      writeReportArtifact: false,
      structuredLogs: false,
      dryRun: true,
      provider: provider('proceed'),
    });
    expect(result.decision.decision).toBe('proceed');
    expect(result.outcome.status).toBe('ok');
    expect(result.effects.effects).toContain('set-outputs');
    expect(result.commentStatus).toBe('skipped');
    expect(result.checkStatus).toBe('skipped');
  });

  it('escalates and dry-runs mutating GitHub writes', async () => {
    const risky = buildReleaseRiskReport({
      target_ref: 'deadbeef',
      base_ref: 'v1.0.0',
      environment: 'production',
      findings: [{ id: 'h1', severity: 'high', title: 'xss' }],
    });
    let checkTitle = '';
    const result = await runOracle({
      report: risky,
      minConfidence: 0.75,
      lowConfidencePolicy: 'request-review',
      reviewMode: 'continue',
      failOnWarn: false,
      sourceErrorPolicy: 'fail',
      jevProvider: 'custom-compatible',
      timeoutMs: 1000,
      maxItemsToJev: 40,
      commentOnGithub: true,
      createCheckRun: true,
      writeReportArtifact: false,
      requestReviewers: 'alice,bob',
      structuredLogs: true,
      dryRun: true,
      headSha: 'deadbeef',
      provider: provider('hold'),
      logInfo: () => undefined,
      checkRunClient: {
        async createCheckRun(input) {
          checkTitle = input.title;
        },
      },
    });
    expect(result.decision.decision).toBe('hold');
    expect(result.decision.held).toBe(true);
    expect(result.outcome.status).toBe('fail');
    expect(result.commentStatus).toBe('dry-run');
    expect(result.checkStatus).toBe('dry-run');
    expect(result.reviewerStatus).toBe('dry-run');
    expect(checkTitle).toBe('');
    expect(result.effects.effects).not.toContain('publish-release');
  });

  it('creates a check run when dry_run is false', async () => {
    let created = false;
    const result = await runOracle({
      report: clean,
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      reviewMode: 'fail',
      failOnWarn: false,
      sourceErrorPolicy: 'warn',
      jevProvider: 'custom-compatible',
      timeoutMs: 1000,
      maxItemsToJev: 40,
      commentOnGithub: false,
      createCheckRun: true,
      writeReportArtifact: false,
      structuredLogs: false,
      dryRun: false,
      headSha: 'deadbeef',
      provider: provider('warn'),
      checkRunClient: {
        async createCheckRun(input) {
          created = true;
          expect(input.name).toBe('JEV Release Oracle');
          expect(input.conclusion).toBe('neutral');
        },
      },
    });
    expect(created).toBe(true);
    expect(result.checkStatus).toBe('created');
    expect(result.decision.decision).toBe('warn');
  });
});
