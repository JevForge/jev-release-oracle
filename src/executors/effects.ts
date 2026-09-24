import type { ActionStatus } from '../decision/policy.js';
import type { OracleDecision } from '../schemas/oracle.js';

export const ALLOWED_EFFECTS = [
  'set-outputs',
  'fail-step',
  'warn-step',
  'request-review',
  'no-op',
  'pull-request-comment',
  'check-run',
  'write-report',
  'request-reviewers',
] as const;

export type AllowedEffect = (typeof ALLOWED_EFFECTS)[number];

export interface PlannedEffects {
  effects: AllowedEffect[];
  fail: boolean;
}

export function planEffects(input: {
  decision: OracleDecision;
  actionStatus: ActionStatus;
  comment: boolean;
  checkRun: boolean;
  writeReport: boolean;
  requestReviewers: boolean;
}): PlannedEffects {
  const effects: AllowedEffect[] = ['set-outputs'];
  if (input.actionStatus === 'fail') effects.push('fail-step');
  else if (input.actionStatus === 'warn') effects.push('warn-step');
  else if (input.actionStatus === 'request-review') effects.push('request-review');
  else if (input.actionStatus === 'no-op') effects.push('no-op');
  if (input.comment) effects.push('pull-request-comment');
  if (input.checkRun) effects.push('check-run');
  if (input.writeReport) effects.push('write-report');
  if (input.requestReviewers) effects.push('request-reviewers');
  return { effects, fail: input.actionStatus === 'fail' };
}

export function renderSummaryMarkdown(decision: OracleDecision): string {
  return [
    '### JEV Release Oracle',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Decision | \`${decision.decision}\` |`,
    `| Policy floor | \`${decision.policy_floor}\` |`,
    `| Jev proposed | \`${decision.jev_proposed ?? 'none'}\` |`,
    `| Jev status | \`${decision.jev_status}\` |`,
    `| Confidence | ${decision.confidence.toFixed(3)} |`,
    `| Provisional | ${decision.provisional ? 'yes' : 'no'} |`,
    `| Held | ${decision.held ? 'yes' : 'no'} |`,
    `| Reason codes | ${decision.reason_codes.map(code => `\`${code}\``).join(', ')} |`,
    `| Recommended checks | ${decision.recommended_checks.map(check => `\`${check}\``).join(', ') || '`none`'} |`,
    '',
    decision.explanation,
    '',
    '_This Action never publishes releases or deploys. Effects are allowlisted only._',
  ].join('\n');
}
