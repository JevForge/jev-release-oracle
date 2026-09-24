import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionStatus } from '../decision/policy.js';
import type { OracleDecision } from '../schemas/oracle.js';
import { renderSummaryMarkdown } from '../executors/effects.js';

export interface ActionOutputWriter {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

const LOG_PREFIX = '[JEV Release Oracle]';

export function formatActionMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return LOG_PREFIX;
  if (trimmed.startsWith(LOG_PREFIX)) return trimmed;
  return `${LOG_PREFIX} ${trimmed}`;
}

export function writeDecisionOutputs(
  writer: ActionOutputWriter,
  decision: OracleDecision,
  actionStatus: ActionStatus,
  extras?: {
    checkStatus?: string;
    reportMarkdownFile?: string | null;
    reportJsonFile?: string | null;
  },
): void {
  writer.setOutput('decision', decision.decision);
  writer.setOutput('confidence', String(decision.confidence));
  writer.setOutput('reason_codes', JSON.stringify(decision.reason_codes));
  writer.setOutput('risk_summary', JSON.stringify(decision.risk_summary));
  writer.setOutput('recommended_checks', JSON.stringify(decision.recommended_checks));
  writer.setOutput('held', String(decision.held));
  writer.setOutput('provisional', String(decision.provisional));
  writer.setOutput('jev_status', decision.jev_status);
  writer.setOutput('jev_proposed', decision.jev_proposed ?? '');
  writer.setOutput('policy_floor', decision.policy_floor);
  writer.setOutput('summary', decision.summary);
  writer.setOutput('check_status', extras?.checkStatus ?? 'skipped');
  writer.setOutput('report_markdown_file', extras?.reportMarkdownFile ?? '');
  writer.setOutput('report_json_file', extras?.reportJsonFile ?? '');

  if (actionStatus === 'fail') {
    writer.setFailed(formatActionMessage(`${decision.decision}: ${decision.explanation || decision.summary}`));
  } else if (actionStatus === 'warn') {
    writer.warning(formatActionMessage(decision.explanation || 'Release oracle warning'));
  } else if (actionStatus === 'request-review') {
    writer.warning(formatActionMessage('Release oracle requires human review'));
  } else {
    writer.info(formatActionMessage(decision.explanation || decision.decision));
  }
}

export function writeReportArtifacts(
  workspace: string,
  decision: OracleDecision,
): { markdownPath: string; jsonPath: string } {
  const dir = join(workspace, '.jev');
  mkdirSync(dir, { recursive: true });
  const markdownPath = join(dir, 'release-oracle-report.md');
  const jsonPath = join(dir, 'release-oracle-report.json');
  writeFileSync(markdownPath, renderSummaryMarkdown(decision));
  writeFileSync(jsonPath, JSON.stringify(decision, null, 2));
  return { markdownPath, jsonPath };
}
