import type { CommitInfo, PullRequestInfo, SourceError } from '../schemas/oracle.js';
import { isBreakingCommitMessage } from './signals.js';
import { sanitizeText } from '../utils/redact.js';

export interface CompareClient {
  compareCommits(owner: string, repo: string, base: string, head: string): Promise<{
    commits: Array<{ sha: string; commit?: { message?: string; author?: { name?: string } } }>;
  }>;
  listAssociatedPulls?(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<Array<{ number: number; title: string; draft?: boolean; labels?: Array<{ name?: string }> }>>;
}

export async function fetchGithubCompare(input: {
  client: CompareClient;
  owner: string;
  repo: string;
  baseRef: string;
  targetRef: string;
}): Promise<{ commits: CommitInfo[]; prs: PullRequestInfo[]; errors: SourceError[] }> {
  const errors: SourceError[] = [];
  try {
    const compared = await input.client.compareCommits(
      input.owner,
      input.repo,
      input.baseRef,
      input.targetRef,
    );
    const commits: CommitInfo[] = (compared.commits ?? []).slice(0, 500).map(item => {
      const message = sanitizeText(item.commit?.message ?? '', 500);
      return {
        sha: item.sha.slice(0, 40),
        message,
        author: item.commit?.author?.name ? sanitizeText(item.commit.author.name, 128) : undefined,
        breaking: isBreakingCommitMessage(message),
      };
    });

    const prs: PullRequestInfo[] = [];
    const seen = new Set<number>();
    if (input.client.listAssociatedPulls) {
      for (const commit of commits.slice(0, 20)) {
        try {
          const associated = await input.client.listAssociatedPulls(input.owner, input.repo, commit.sha);
          for (const pull of associated) {
            if (seen.has(pull.number)) continue;
            seen.add(pull.number);
            prs.push({
              number: pull.number,
              title: sanitizeText(pull.title, 300),
              draft: Boolean(pull.draft),
              labels: (pull.labels ?? [])
                .map(label => label.name)
                .filter((name): name is string => typeof name === 'string')
                .slice(0, 32),
            });
            if (prs.length >= 200) break;
          }
        } catch (error) {
          errors.push({
            source: 'github-compare-prs',
            message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
          });
        }
        if (prs.length >= 200) break;
      }
    }
    return { commits, prs, errors };
  } catch (error) {
    return {
      commits: [],
      prs: [],
      errors: [
        {
          source: 'github-compare',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        },
      ],
    };
  }
}
