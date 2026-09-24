import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFindings } from '../../src/collectors/findings.js';
import { filterIncidentsByLabels, loadIncidents } from '../../src/collectors/incidents.js';
import { loadMetrics } from '../../src/collectors/metrics.js';
import { loadChangelog } from '../../src/collectors/changelog.js';
import { normalizeIncidentSeverity, normalizeSeverity } from '../../src/collectors/signals.js';
import { maybePostComment, maybeRequestReviewers } from '../../src/executors/comment.js';
import { writeReportArtifacts } from '../../src/github/outputs.js';
import { applyOraclePolicy } from '../../src/decision/policy.js';
import { buildReleaseRiskReport } from '../../src/collectors/aggregate.js';
import { sanitizeText, safeError } from '../../src/utils/redact.js';
import { resolveInsideWorkspace, parseJsonOrYaml } from '../../src/utils/paths.js';

describe('collector and util edges', () => {
  it('parses findings, sarif, incidents, metrics, and changelog files', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-cov-'));
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(
      join(root, 'data', 'findings.json'),
      JSON.stringify({
        findings: [{ id: 'f1', severity: 'error', title: 'bad', package: 'x', cve: 'CVE-1', rule_id: 'rule/f1', path: 'src/a.ts', start_line: 7 }],
      }),
    );
    writeFileSync(
      join(root, 'data', 'report.sarif'),
      JSON.stringify({
        runs: [
          {
            results: [
              {
                ruleId: 'rule-1',
                level: 'error',
                message: { text: 'issue' },
                properties: { cve: 'CVE-2026-1' },
                partialFingerprints: { primaryLocationLineHash: 'fingerprint-12345678' },
              },
            ],
          },
        ],
      }),
    );
    writeFileSync(
      join(root, 'data', 'incidents.json'),
      JSON.stringify({
        incidents: [
          { id: '99', severity: 'critical', title: 'outage', status: 'open', labels: ['sev1'] },
          { number: 7, severity: 'sev2', title: 'degraded', status: 'mitigated' },
        ],
      }),
    );
    writeFileSync(
      join(root, 'data', 'metrics.json'),
      JSON.stringify([{ name: 'cpu', value: 90, threshold: 80 }]),
    );
    writeFileSync(
      join(root, 'data', 'changelog.json'),
      JSON.stringify({ present: true, breaking_mentioned: true }),
    );

    const findings = loadFindings(root, 'data/findings.json', 'data/report.sarif');
    expect(findings.findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.findings.some(f => f.severity === 'high')).toBe(true);
    expect(findings.findings.some(f => f.rule_id === 'rule/f1' && f.path === 'src/a.ts' && f.start_line === 7)).toBe(true);
    expect(findings.findings.some(f => f.cve === 'CVE-2026-1' && f.fingerprint === 'fingerprint-12345678')).toBe(true);

    const incidents = loadIncidents(root, 'data/incidents.json');
    expect(incidents.incidents).toHaveLength(2);
    expect(filterIncidentsByLabels(incidents.incidents, ['sev1'])[0]?.id).toBe('99');

    const metrics = loadMetrics(root, 'data/metrics.json');
    expect(metrics.metrics[0]?.breached).toBe(true);

    const changelog = loadChangelog(root, 'data/changelog.json');
    expect(changelog.changelog.breaking_mentioned).toBe(true);

    expect(normalizeSeverity('warning')).toBe('medium');
    expect(normalizeSeverity('note')).toBe('low');
    expect(normalizeIncidentSeverity('SEV 1')).toBe('sev1');
    expect(normalizeIncidentSeverity('high')).toBe('sev2');
  });

  it('posts and updates comments and requests reviewers', async () => {
    const decision = applyOraclePolicy({
      report: buildReleaseRiskReport({
        target_ref: 'a',
        base_ref: null,
        environment: 'staging',
      }),
      jev: {
        status: 'evaluated',
        decision: 'warn',
        confidence: 0.9,
        explanation: 'warn',
        abstain: false,
      },
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      sourceErrorPolicy: 'warn',
      reviewMode: 'fail',
      failOnWarn: false,
    }).decision;

    const comments: Array<{ id: number; body: string }> = [];
    const commentStatus = await maybePostComment(true, false, decision, {
      async listComments() {
        return comments;
      },
      async createComment(body) {
        comments.push({ id: 1, body });
      },
      async updateComment(id, body) {
        const found = comments.find(comment => comment.id === id);
        if (found) found.body = body;
      },
    });
    expect(commentStatus).toBe('posted');
    const updated = await maybePostComment(true, false, decision, {
      async listComments() {
        return comments;
      },
      async createComment() {
        throw new Error('should update');
      },
      async updateComment(id, body) {
        const found = comments.find(comment => comment.id === id);
        if (found) found.body = body;
      },
    });
    expect(updated).toBe('updated');

    let requested: string[] = [];
    const reviewers = await maybeRequestReviewers(true, false, '@alice, bob', {
      async requestReviewers(logins) {
        requested = logins;
      },
    });
    expect(reviewers).toBe('requested');
    expect(requested).toEqual(['alice', 'bob']);
  });

  it('writes report artifacts and sanitizes secrets', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-oracle-art-'));
    const decision = applyOraclePolicy({
      report: buildReleaseRiskReport({
        target_ref: 'a',
        base_ref: null,
        environment: 'staging',
      }),
      jev: {
        status: 'evaluated',
        decision: 'proceed',
        confidence: 0.9,
        explanation: 'ok',
        abstain: false,
      },
      minConfidence: 0.75,
      lowConfidencePolicy: 'fail',
      sourceErrorPolicy: 'warn',
      reviewMode: 'fail',
      failOnWarn: false,
    }).decision;
    const written = writeReportArtifacts(root, decision, buildReleaseRiskReport({
      target_ref: 'a',
      base_ref: null,
      environment: 'staging',
      findings: [{ id: 'baseline-finding', severity: 'high', title: 'known' }],
    }));
    expect(written.markdownPath).toContain('release-oracle-report.md');
    expect(written.jsonPath).toContain('release-oracle-report.json');
    expect(JSON.parse(readFileSync(written.jsonPath, 'utf8')).findings[0].id).toBe('baseline-finding');
    expect(sanitizeText('token ghp_abcdefghijklmnopqrstuvwxyz12')).toContain('[REDACTED]');
    expect(sanitizeText('https://jev.example/evaluate?api_key=secret-value')).toContain('[REDACTED]');
    expect(safeError(new Error('boom'))).toContain('boom');
    expect(resolveInsideWorkspace(root, '../escape')).toBeNull();
    expect(parseJsonOrYaml('name: demo\nvalue: 1')).toEqual({ name: 'demo', value: 1 });
    expect(loadMetrics(root, 'missing-metrics.json').errors[0]?.source).toBe('metrics');
    expect(loadMetrics(root, undefined, '{not-json').errors[0]?.source).toBe('metrics');
  });
});
