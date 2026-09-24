import { describe, expect, it } from 'vitest';
import { fetchPreviousReleaseBaseline } from '../../src/collectors/github-baseline.js';

describe('GitHub release baseline', () => {
  it('loads the previous stable release report when new_only is enabled', async () => {
    const result = await fetchPreviousReleaseBaseline({
      owner: 'JevForge',
      repo: 'app',
      targetRef: 'v2.0.0',
      reportPath: '.jev/release-oracle-report.json',
      client: {
        async listReleases() {
          return [
            { tag_name: 'v2.0.0', draft: false, prerelease: false },
            { tag_name: 'v1.0.0', draft: false, prerelease: false },
          ];
        },
        async getFileAtRef(_owner, _repo, path, ref) {
          expect(path).toBe('.jev/release-oracle-report.json');
          expect(ref).toBe('v1.0.0');
          return Buffer.from(JSON.stringify({ findings: [], incidents: [] })).toString('base64');
        },
      },
    });

    expect(result.ref).toBe('v1.0.0');
    expect(result.snapshot).toEqual({ findings: [], incidents: [] });
    expect(result.error).toBeUndefined();
  });

  it('reports a useful error when no prior release report exists', async () => {
    const result = await fetchPreviousReleaseBaseline({
      owner: 'JevForge',
      repo: 'app',
      targetRef: 'v1.0.0',
      reportPath: '.jev/release-oracle-report.json',
      client: {
        async listReleases() {
          return [{ tag_name: 'v1.0.0', draft: false, prerelease: false }];
        },
        async getFileAtRef() {
          return null;
        },
      },
    });

    expect(result.ref).toBeNull();
    expect(result.error).toMatch(/previous release|baseline report/i);
  });
});
