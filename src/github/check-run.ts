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
  findExistingCheckRun?(input: { name: string; headSha: string }): Promise<{ id: number } | null>;
  createCheckRun(input: {
    name: string;
    headSha: string;
    conclusion: 'success' | 'neutral' | 'failure';
    title: string;
    summary: string;
  }): Promise<void>;
  updateCheckRun?(id: number, input: {
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

  const input = {
    name: 'JEV Release Oracle',
    headSha,
    conclusion: checkConclusion(actionStatus),
    title: `${decision.decision} · floor ${decision.policy_floor}`,
    summary: renderSummaryMarkdown(decision),
  };
  const existing = client.findExistingCheckRun
    ? await client.findExistingCheckRun({ name: input.name, headSha })
    : null;
  if (existing && client.updateCheckRun) await client.updateCheckRun(existing.id, input);
  else await client.createCheckRun(input);
  return 'created';
}
