import { DECISION_RANK, type Decision } from '../schemas/enums.js';
import type { Finding, Metric, SourceError } from '../schemas/oracle.js';
import { normalizeSeverity } from './signals.js';
import { parseJsonOrYaml } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';
import { parseMetricsDocument } from './metrics.js';

export interface SiblingInput {
  sentinelDecision?: string;
  sentinelFindings?: string;
  costDecision?: string;
  costMetrics?: string;
}

export interface SiblingSignals {
  decision: Decision | null;
  decisions: Array<{ source: 'security-sentinel' | 'cloud-cost-guardian'; decision: Decision }>;
  findings: Finding[];
  metrics: Metric[];
  errors: SourceError[];
}

function parseValue(raw: string, source: string): { value: unknown; error?: SourceError } {
  try {
    return { value: parseJsonOrYaml(raw) };
  } catch (error) {
    return {
      value: null,
      error: {
        source,
        message: sanitizeText(`Invalid sibling output: ${error instanceof Error ? error.message : String(error)}`, 400),
      },
    };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decisionFromValue(value: unknown, source: 'security-sentinel' | 'cloud-cost-guardian'): Decision | null {
  const raw = typeof value === 'string' ? value : record(value)?.decision;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  const mapped = source === 'security-sentinel'
    ? { pass: 'proceed', proceed: 'proceed', warn: 'warn', review: 'review', block: 'hold', hold: 'hold' }[normalized]
    : { approve: 'proceed', proceed: 'proceed', warn: 'warn', 'manual-review': 'review', review: 'review', block: 'hold', hold: 'hold' }[normalized];
  return mapped as Decision | undefined ?? null;
}

function parseFindings(value: unknown): Finding[] {
  const list = Array.isArray(value) ? value : record(value)?.findings;
  if (!Array.isArray(list)) return [];
  const findings: Finding[] = [];
  for (const item of list.slice(0, 2000)) {
    const row = record(item);
    if (!row) continue;
    const id = typeof row.id === 'string'
      ? row.id
      : typeof row.rule_id === 'string'
        ? row.rule_id
        : typeof row.fingerprint === 'string'
          ? row.fingerprint
          : null;
    if (!id) continue;
    findings.push({
      id: sanitizeText(id, 128),
      severity: normalizeSeverity(row.severity),
      title: sanitizeText(String(row.title ?? row.message ?? row.rule_id ?? id), 300),
      package: typeof row.package === 'string'
        ? sanitizeText(row.package, 200)
        : typeof row.component === 'string'
          ? sanitizeText(row.component, 200)
          : undefined,
      cve: typeof row.cve === 'string' ? sanitizeText(row.cve, 64) : undefined,
    });
  }
  return findings;
}

function parseMetrics(value: unknown): Metric[] {
  const metrics = parseMetricsDocument(value);
  const root = record(value);
  if (root && typeof root.utilization === 'number') {
    metrics.push({ name: 'cost_utilization', value: root.utilization, threshold: 1, breached: root.utilization >= 1 });
  }
  if (root && typeof root.budget_remaining === 'number') {
    metrics.push({ name: 'cost_budget_remaining', value: root.budget_remaining, threshold: 0, breached: root.budget_remaining < 0 });
  }
  return metrics.slice(0, 200);
}

export function parseSiblingSignals(input: SiblingInput): SiblingSignals {
  const errors: SourceError[] = [];
  const decisions: SiblingSignals['decisions'] = [];
  let findings: Finding[] = [];
  let metrics: Metric[] = [];

  if (input.sentinelDecision?.trim()) {
    const parsed = parseValue(input.sentinelDecision, 'security-sentinel');
    if (parsed.error) errors.push(parsed.error);
    else {
      const decision = decisionFromValue(parsed.value, 'security-sentinel');
      if (decision) decisions.push({ source: 'security-sentinel', decision });
      else errors.push({ source: 'security-sentinel', message: 'Unrecognized Security Sentinel decision output' });
    }
  }
  if (input.sentinelFindings?.trim()) {
    const parsed = parseValue(input.sentinelFindings, 'security-sentinel');
    if (parsed.error) errors.push(parsed.error);
    else findings = findings.concat(parseFindings(parsed.value));
  }
  if (input.costDecision?.trim()) {
    const parsed = parseValue(input.costDecision, 'cloud-cost-guardian');
    if (parsed.error) errors.push(parsed.error);
    else {
      const decision = decisionFromValue(parsed.value, 'cloud-cost-guardian');
      if (decision) decisions.push({ source: 'cloud-cost-guardian', decision });
      else errors.push({ source: 'cloud-cost-guardian', message: 'Unrecognized Cloud Cost Guardian decision output' });
      metrics = metrics.concat(parseMetrics(parsed.value));
    }
  }
  if (input.costMetrics?.trim()) {
    const parsed = parseValue(input.costMetrics, 'cloud-cost-guardian');
    if (parsed.error) errors.push(parsed.error);
    else metrics = metrics.concat(parseMetrics(parsed.value));
  }

  const decision = decisions.reduce<Decision | null>((current, item) => {
    if (!current || DECISION_RANK[item.decision] > DECISION_RANK[current]) return item.decision;
    return current;
  }, null);
  return { decision, decisions, findings: findings.slice(0, 2000), metrics: metrics.slice(0, 200), errors };
}
