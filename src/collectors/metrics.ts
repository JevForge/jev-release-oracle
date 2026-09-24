import type { Metric, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';

function parseMetrics(raw: unknown): Metric[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { metrics?: unknown }).metrics)
      ? (raw as { metrics: unknown[] }).metrics
      : raw && typeof raw === 'object' && Array.isArray((raw as { findings?: unknown }).findings)
        ? (raw as { findings: unknown[] }).findings
        : [];
  const out: Metric[] = [];
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const isCostLine = typeof row.id === 'string' && typeof row.monthly_cost === 'number' && Number.isFinite(row.monthly_cost);
    const name = typeof row.name === 'string' ? row.name : null;
    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
    if (
      (!isCostLine && name === null) ||
      (!isCostLine && value === null)
    ) {
      continue;
    }
    if (isCostLine) {
      out.push({
        name: sanitizeText(`cost:${row.id}`, 128),
        value: row.monthly_cost as number,
        breached: false,
        unit: typeof row.currency === 'string' ? sanitizeText(row.currency, 32) : undefined,
      });
      continue;
    }
    const threshold =
      typeof row.threshold === 'number' && Number.isFinite(row.threshold) ? row.threshold : undefined;
    const breached =
      typeof row.breached === 'boolean'
        ? row.breached
        : threshold != null
          ? value! > threshold
          : false;
    out.push({
      name: sanitizeText(name!, 128),
      value: value!,
      threshold,
      breached,
      unit: typeof row.unit === 'string' ? sanitizeText(row.unit, 32) : undefined,
    });
  }
  return out;
}

export function parseMetricsDocument(raw: unknown): Metric[] {
  return parseMetrics(raw);
}

export function loadMetrics(
  workspace: string,
  path: string | undefined,
  metricsJson?: string,
): { metrics: Metric[]; errors: SourceError[] } {
  const inline = metricsJson;
  if (!path?.trim() && !inline?.trim()) return { metrics: [], errors: [] };
  if (!path?.trim() && inline?.trim()) {
    try {
      return { metrics: parseMetrics(parseJsonOrYaml(inline)), errors: [] };
    } catch (error) {
      return {
        metrics: [],
        errors: [{ source: 'metrics', message: sanitizeText(error instanceof Error ? error.message : String(error), 400) }],
      };
    }
  }
  const filePath = path as string;
  const text = readWorkspaceText(workspace, filePath);
  if (text == null) {
    return {
      metrics: [],
      errors: [{ source: 'metrics', message: `Metrics file not found: ${sanitizeText(filePath, 200)}` }],
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
