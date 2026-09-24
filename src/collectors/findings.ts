import type { Finding, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';
import { normalizeSeverity } from './signals.js';

function fromNormalized(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === 'object' && Array.isArray((raw as { findings?: unknown }).findings)) {
      return fromNormalized((raw as { findings: unknown[] }).findings);
    }
    return [];
  }
  const out: Finding[] = [];
  for (const item of raw.slice(0, 2000)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : typeof row.rule_id === 'string' ? row.rule_id : null;
    if (!id) continue;
    out.push({
      id: sanitizeText(id, 128),
      severity: normalizeSeverity(row.severity),
      title: sanitizeText(String(row.title ?? row.message ?? id), 300),
      package: typeof row.package === 'string' ? sanitizeText(row.package, 200) : undefined,
      cve: typeof row.cve === 'string' ? sanitizeText(row.cve, 64) : undefined,
    });
  }
  return out;
}

function fromSarif(raw: unknown): Finding[] {
  if (!raw || typeof raw !== 'object') return [];
  const runs = (raw as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return [];
  const out: Finding[] = [];
  let index = 0;
  for (const run of runs) {
    const results = (run as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      const row = result as Record<string, unknown>;
      const level = typeof row.level === 'string' ? row.level : 'warning';
      const ruleId = typeof row.ruleId === 'string' ? row.ruleId : `sarif-${index}`;
      const message =
        row.message && typeof row.message === 'object'
          ? String((row.message as { text?: string }).text ?? ruleId)
          : String(row.message ?? ruleId);
      out.push({
        id: sanitizeText(ruleId, 128),
        severity: normalizeSeverity(level),
        title: sanitizeText(message, 300),
      });
      index += 1;
      if (out.length >= 2000) return out;
    }
  }
  return out;
}

export function loadFindings(
  workspace: string,
  findingsPath: string | undefined,
  sarifPath: string | undefined,
): { findings: Finding[]; errors: SourceError[] } {
  const errors: SourceError[] = [];
  const findings: Finding[] = [];

  if (findingsPath?.trim()) {
    const text = readWorkspaceText(workspace, findingsPath);
    if (text == null) {
      errors.push({
        source: 'findings',
        message: `Findings file not found: ${sanitizeText(findingsPath, 200)}`,
      });
    } else {
      try {
        findings.push(...fromNormalized(parseJsonOrYaml(text)));
      } catch (error) {
        errors.push({
          source: 'findings',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        });
      }
    }
  }

  if (sarifPath?.trim()) {
    const text = readWorkspaceText(workspace, sarifPath);
    if (text == null) {
      errors.push({
        source: 'sarif',
        message: `SARIF file not found: ${sanitizeText(sarifPath, 200)}`,
      });
    } else {
      try {
        findings.push(...fromSarif(parseJsonOrYaml(text)));
      } catch (error) {
        errors.push({
          source: 'sarif',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        });
      }
    }
  }

  return { findings: findings.slice(0, 2000), errors };
}
