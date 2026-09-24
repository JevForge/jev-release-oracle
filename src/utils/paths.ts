import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

export function resolveInsideWorkspace(workspace: string, candidate: string): string | null {
  const trimmed = candidate.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0')) return null;
  if (trimmed.split('/').includes('..')) return null;
  const absolute = isAbsolute(trimmed) ? normalize(trimmed) : resolve(workspace, trimmed);
  const rel = relative(resolve(workspace), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

export function readWorkspaceText(workspace: string, relativePath: string): string | null {
  const full = resolveInsideWorkspace(workspace, relativePath);
  if (!full || !existsSync(full)) return null;
  try {
    if (!statSync(full).isFile()) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

export function parseJsonOrYaml(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown;
  }
  return parseYaml(trimmed) as unknown;
}

export function joinWorkspace(workspace: string, ...parts: string[]): string {
  return join(workspace, ...parts).split(sep).join('/');
}
