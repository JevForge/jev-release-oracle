import type { ChangelogInfo, SourceError } from '../schemas/oracle.js';
import { parseJsonOrYaml, readWorkspaceText } from '../utils/paths.js';
import { sanitizeText } from '../utils/redact.js';

const BREAKING_RE = /breaking[\s_-]?change|!\s*:|major\s+version/i;

export function parseChangelogText(text: string, path: string | null = null): ChangelogInfo {
  const present = text.trim().length > 0;
  return {
    present,
    breaking_mentioned: present && BREAKING_RE.test(text),
    path,
  };
}

export function loadChangelog(
  workspace: string,
  path: string | undefined,
): { changelog: ChangelogInfo; errors: SourceError[] } {
  if (!path?.trim()) {
    return { changelog: { present: false, breaking_mentioned: false, path: null }, errors: [] };
  }
  const text = readWorkspaceText(workspace, path);
  if (text == null) {
    return {
      changelog: { present: false, breaking_mentioned: false, path },
      errors: [{ source: 'changelog', message: `Changelog not found: ${sanitizeText(path, 200)}` }],
    };
  }
  // Prefer structured documents that declare present/breaking flags.
  try {
    const parsed = parseJsonOrYaml(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if ('present' in obj || 'breaking_mentioned' in obj) {
        return {
          changelog: {
            present: Boolean(obj.present ?? true),
            breaking_mentioned: Boolean(obj.breaking_mentioned),
            path,
          },
          errors: [],
        };
      }
    }
  } catch {
    // Treat as plain markdown/text.
  }
  return { changelog: parseChangelogText(text, path), errors: [] };
}
