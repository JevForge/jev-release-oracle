import { parseJsonOrYaml } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';
import { parseBaselineSnapshot, type BaselineSnapshot } from './baseline.js';

export interface ReleaseBaselineClient {
  listReleases(owner: string, repo: string): Promise<Array<{ tag_name: string; draft?: boolean; prerelease?: boolean }>>;
  getFileAtRef(owner: string, repo: string, path: string, ref: string): Promise<string | null>;
}

export async function fetchPreviousReleaseBaseline(input: {
  owner: string;
  repo: string;
  targetRef: string;
  reportPath: string;
  client: ReleaseBaselineClient;
}): Promise<{ ref: string | null; snapshot?: BaselineSnapshot; error?: string }> {
  try {
    const releases = await input.client.listReleases(input.owner, input.repo);
    const target = input.targetRef.replace(/^refs\/tags\//, '');
    const previous = releases.find(
      release => !release.draft && !release.prerelease && release.tag_name !== target,
    );
    if (!previous) return { ref: null, error: 'No previous release is available for a baseline report' };

    const encoded = await input.client.getFileAtRef(
      input.owner,
      input.repo,
      input.reportPath,
      previous.tag_name,
    );
    if (!encoded) {
      return { ref: previous.tag_name, error: `Previous release baseline report not found at ${input.reportPath}` };
    }
    const raw = Buffer.from(encoded, 'base64').toString('utf8');
    return { ref: previous.tag_name, snapshot: parseBaselineSnapshot(parseJsonOrYaml(raw)) };
  } catch (error) {
    return {
      ref: null,
      error: sanitizeText(`Unable to load previous release baseline: ${error instanceof Error ? error.message : String(error)}`, 500),
    };
  }
}
