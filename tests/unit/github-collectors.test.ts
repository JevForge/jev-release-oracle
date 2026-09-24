import { describe, expect, it } from 'vitest';
import { fetchChecks } from '../../src/collectors/checks.js';
import { fetchDeployments } from '../../src/collectors/deployments.js';
import { fetchGithubCompare } from '../../src/collectors/github-compare.js';

describe('GitHub collectors', () => {
  it('maps compare commits and deduplicates associated pull requests', async () => {
    const result = await fetchGithubCompare({
      owner: 'o',
      repo: 'r',
      baseRef: 'v1',
      targetRef: 'v2',
      client: {
        async compareCommits() {
          return {
            commits: [
              { sha: 'a', commit: { message: 'feat!: break', author: { name: 'Ada' } } },
              { sha: 'b', commit: { message: 'fix: safe' } },
            ],
          };
        },
        async listAssociatedPulls(_owner, _repo, sha) {
          return sha === 'a'
            ? [{ number: 1, title: 'API', labels: [{ name: 'release' }] }]
            : [{ number: 1, title: 'API' }, { number: 2, title: 'Docs', draft: true }];
        },
      },
    });

    expect(result.commits[0]).toEqual(expect.objectContaining({ sha: 'a', breaking: true, author: 'Ada' }));
    expect(result.prs.map(pr => pr.number)).toEqual([1, 2]);
    expect(result.errors).toEqual([]);
  });

  it('preserves check conclusions and distinguishes pending from failed', async () => {
    const result = await fetchChecks({
      owner: 'o',
      repo: 'r',
      ref: 'sha',
      client: {
        async listCheckRunsForRef() {
          return [
            { status: 'queued', conclusion: null },
            { status: 'completed', conclusion: 'timed_out' },
            { status: 'completed', conclusion: 'not-a-real-state', required: false },
          ];
        },
      },
    });
    expect(result.checks).toMatchObject({ total: 3, pending: 1, failure: 1, required_failed: 1 });
    expect(result.checks.conclusions).toEqual(['pending', 'timed_out', 'unknown']);
  });

  it('handles deployments without statuses and maps provider errors', async () => {
    const result = await fetchDeployments({
      owner: 'o',
      repo: 'r',
      environment: 'production',
      client: {
        async listDeployments() {
          return [{ id: 1 }, { id: 2 }];
        },
        async getStatuses(_owner, _repo, id) {
          if (id === 1) return [];
          throw new Error('HTTP 429');
        },
      },
    });
    expect(result.deployments).toMatchObject({ total: 2 });
    expect(result.errors[0]?.source).toBe('github-deployments');
  });
});
