import type { OracleDecision } from '../schemas/oracle.js';
import { renderSummaryMarkdown } from './effects.js';

/** Stable marker so re-runs update one PR comment instead of stacking. */
export const COMMENT_MARKER = '<!-- jev-release-oracle -->';

export function buildCommentMarkdown(decision: OracleDecision): string {
  return `${COMMENT_MARKER}\n${renderSummaryMarkdown(decision)}`;
}

export interface CommentClient {
  listComments(): Promise<Array<{ id: number; body: string }>>;
  createComment(body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

export async function maybePostComment(
  enabled: boolean,
  dryRun: boolean,
  decision: OracleDecision,
  client: CommentClient | null,
): Promise<'posted' | 'updated' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  const body = buildCommentMarkdown(decision);
  if (dryRun || !client) return 'dry-run';

  const existing = (await client.listComments()).find(comment => comment.body.includes(COMMENT_MARKER));
  if (existing) {
    await client.updateComment(existing.id, body);
    return 'updated';
  }
  await client.createComment(body);
  return 'posted';
}

export interface ReviewerClient {
  requestReviewers(logins: string[]): Promise<void>;
}

export async function maybeRequestReviewers(
  enabled: boolean,
  dryRun: boolean,
  reviewersRaw: string | undefined,
  client: ReviewerClient | null,
): Promise<'requested' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  const logins = (reviewersRaw ?? '')
    .split(/[,\n]+/)
    .map(part => part.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 20);
  if (!logins.length) return 'skipped';
  if (dryRun || !client) return 'dry-run';
  await client.requestReviewers(logins);
  return 'requested';
}
