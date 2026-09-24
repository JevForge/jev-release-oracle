import type { ActionStatus } from '../decision/policy.js';
import type { OracleDecision } from '../schemas/oracle.js';
import { renderSummaryMarkdown } from '../executors/effects.js';

export function checkConclusion(
  actionStatus: ActionStatus,
): 'success' | 'neutral' | 'failure' {
  if (actionStatus === 'ok') return 'success';
  if (actionStatus === 'fail') return 'failure';
  return 'neutral';
}

export interface CheckRunClient {
  createCheckRun(input: {
    name: string;
    headSha: string;
    conclusion: 'success' | 'neutral' | 'failure';
    title: string;
    summary: string;
  }): Promise<void>;
}

export async function maybeCreateCheckRun(
  enabled: boolean,
  dryRun: boolean,
  headSha: string | null,
  decision: OracleDecision,
  actionStatus: ActionStatus,
  client: CheckRunClient | null,
): Promise<'created' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  if (!headSha) return 'skipped';
  if (dryRun || !client) return 'dry-run';

  await client.createCheckRun({
    name: 'JEV Release Oracle',
    headSha,
    conclusion: checkConclusion(actionStatus),
    title: `${decision.decision} · floor ${decision.policy_floor}`,
    summary: renderSummaryMarkdown(decision),
  });
  return 'created';
}
