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
      fingerprint: typeof row.fingerprint === 'string' ? sanitizeText(row.fingerprint, 128) : undefined,
      source: typeof row.source === 'string' ? sanitizeText(row.source, 64) : undefined,
      rule_id: typeof row.rule_id === 'string' ? sanitizeText(row.rule_id, 256) : undefined,
      path: typeof row.path === 'string' ? sanitizeText(row.path, 512) : undefined,
      start_line: typeof row.start_line === 'number' && Number.isInteger(row.start_line) && row.start_line > 0
        ? row.start_line
        : undefined,
      severity: normalizeSeverity(row.severity),
      title: sanitizeText(String(row.title ?? row.message ?? id), 300),
      package: typeof row.package === 'string' ? sanitizeText(row.package, 200) : undefined,
      cve: typeof row.cve === 'string' ? sanitizeText(row.cve, 64) : undefined,
    });
  }
  return out;
}

export function parseFindingsDocument(raw: unknown): Finding[] {
  return fromNormalized(raw);
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
      const properties = row.properties && typeof row.properties === 'object'
        ? row.properties as Record<string, unknown>
        : {};
      const fingerprints = row.partialFingerprints && typeof row.partialFingerprints === 'object'
        ? row.partialFingerprints as Record<string, unknown>
        : {};
      const location = Array.isArray(row.locations) && row.locations[0] && typeof row.locations[0] === 'object'
        ? row.locations[0] as Record<string, unknown>
        : {};
      const physical = location.physicalLocation && typeof location.physicalLocation === 'object'
        ? location.physicalLocation as Record<string, unknown>
        : {};
      const artifact = physical.artifactLocation && typeof physical.artifactLocation === 'object'
        ? physical.artifactLocation as Record<string, unknown>
        : {};
      const region = physical.region && typeof physical.region === 'object'
        ? physical.region as Record<string, unknown>
        : {};
      const message =
        row.message && typeof row.message === 'object'
          ? String((row.message as { text?: string }).text ?? ruleId)
          : String(row.message ?? ruleId);
      out.push({
        id: sanitizeText(ruleId, 128),
        fingerprint: typeof fingerprints.primaryLocationLineHash === 'string'
          ? sanitizeText(fingerprints.primaryLocationLineHash, 128)
          : undefined,
        rule_id: sanitizeText(ruleId, 256),
        path: typeof artifact.uri === 'string' ? sanitizeText(artifact.uri, 512) : undefined,
        start_line: typeof region.startLine === 'number' && Number.isInteger(region.startLine) && region.startLine > 0
          ? region.startLine
          : undefined,
        cve: typeof properties.cve === 'string' ? sanitizeText(properties.cve, 64) : undefined,
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
  findingsJson?: string,
): { findings: Finding[]; errors: SourceError[] } {
  const errors: SourceError[] = [];
  const findings: Finding[] = [];

  if (findingsJson?.trim()) {
    try {
      findings.push(...fromNormalized(parseJsonOrYaml(findingsJson)));
    } catch (error) {
      errors.push({
        source: 'findings',
        message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
      });
    }
  }

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
