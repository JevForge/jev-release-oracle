import type { Incident, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';
import { normalizeIncidentSeverity } from './signals.js';

function parseIncidents(raw: unknown): Incident[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { incidents?: unknown }).incidents)
      ? (raw as { incidents: unknown[] }).incidents
      : [];
  const out: Incident[] = [];
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : typeof row.number === 'number' ? String(row.number) : null;
    if (!id) continue;
    const statusRaw = typeof row.status === 'string' ? row.status.toLowerCase() : 'unknown';
    const status =
      statusRaw === 'open' || statusRaw === 'mitigated' || statusRaw === 'resolved' ? statusRaw : 'unknown';
    out.push({
      id: sanitizeText(id, 128),
      severity: normalizeIncidentSeverity(row.severity ?? row.sev),
      title: sanitizeText(String(row.title ?? id), 300),
      status,
      opened_at: typeof row.opened_at === 'string' ? sanitizeText(row.opened_at, 64) : undefined,
    });
  }
  return out;
}

export function loadIncidents(
  workspace: string,
  path: string | undefined,
): { incidents: Incident[]; errors: SourceError[] } {
  if (!path?.trim()) return { incidents: [], errors: [] };
  const text = readWorkspaceText(workspace, path);
  if (text == null) {
    return {
      incidents: [],
      errors: [{ source: 'incidents', message: `Incidents file not found: ${sanitizeText(path, 200)}` }],
    };
  }
  try {
    return { incidents: parseIncidents(parseJsonOrYaml(text)), errors: [] };
  } catch (error) {
    return {
      incidents: [],
      errors: [
        {
          source: 'incidents',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        },
      ],
    };
  }
}

export function filterIncidentsByLabels(
  incidents: Incident[],
  labels: string[],
): Incident[] {
  if (!labels.length) return incidents;
  const wanted = new Set(labels.map(label => label.toLowerCase()));
  return incidents.filter(incident => {
    const hay = `${incident.id} ${incident.title} ${incident.severity}`.toLowerCase();
    return [...wanted].some(label => hay.includes(label));
  });
}
