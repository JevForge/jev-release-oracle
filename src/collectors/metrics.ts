import type { Metric, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';

function parseMetrics(raw: unknown): Metric[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { metrics?: unknown }).metrics)
      ? (raw as { metrics: unknown[] }).metrics
      : [];
  const out: Metric[] = [];
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      continue;
    }
    const threshold =
      typeof row.threshold === 'number' && Number.isFinite(row.threshold) ? row.threshold : undefined;
    const breached =
      typeof row.breached === 'boolean'
        ? row.breached
        : threshold != null
          ? row.value > threshold
          : false;
    out.push({
      name: sanitizeText(row.name, 128),
      value: row.value,
      threshold,
      breached,
      unit: typeof row.unit === 'string' ? sanitizeText(row.unit, 32) : undefined,
    });
  }
  return out;
}

export function loadMetrics(
  workspace: string,
  path: string | undefined,
): { metrics: Metric[]; errors: SourceError[] } {
  if (!path?.trim()) return { metrics: [], errors: [] };
  const text = readWorkspaceText(workspace, path);
  if (text == null) {
    return {
      metrics: [],
      errors: [{ source: 'metrics', message: `Metrics file not found: ${sanitizeText(path, 200)}` }],
    };
  }
  try {
    return { metrics: parseMetrics(parseJsonOrYaml(text)), errors: [] };
  } catch (error) {
    return {
      metrics: [],
      errors: [
        {
          source: 'metrics',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        },
      ],
    };
  }
}
