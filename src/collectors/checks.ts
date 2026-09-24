import type { CheckConclusion } from '../schemas/enums.js';
import type { CheckSummary, SourceError } from '../schemas/oracle.js';
import { emptyChecks } from './signals.js';
import { sanitizeText } from '../utils/redact.js';

export interface ChecksClient {
  listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<Array<{ name?: string; conclusion?: string | null; status?: string; required?: boolean }>>;
}

function mapConclusion(value: string | null | undefined, status?: string): CheckConclusion {
  if (status === 'queued' || status === 'in_progress' || status === 'waiting') return 'pending';
  const raw = (value ?? 'unknown').toLowerCase();
  const allowed: CheckConclusion[] = [
    'success',
    'failure',
    'neutral',
    'cancelled',
    'timed_out',
    'action_required',
    'stale',
    'skipped',
    'pending',
    'unknown',
  ];
  return (allowed.includes(raw as CheckConclusion) ? raw : 'unknown') as CheckConclusion;
}

export async function fetchChecks(input: {
  client: ChecksClient;
  owner: string;
  repo: string;
  ref: string;
}): Promise<{ checks: CheckSummary; errors: SourceError[] }> {
  try {
    const runs = await input.client.listCheckRunsForRef(input.owner, input.repo, input.ref);
    const checks = emptyChecks();
    for (const run of runs.slice(0, 200)) {
      const conclusion = mapConclusion(run.conclusion, run.status);
      checks.total += 1;
      checks.conclusions.push(conclusion);
      if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral') {
        checks.success += 1;
      } else if (conclusion === 'pending') {
        checks.pending += 1;
      } else if (
        conclusion === 'failure' ||
        conclusion === 'timed_out' ||
        conclusion === 'cancelled' ||
        conclusion === 'action_required'
      ) {
        checks.failure += 1;
        if (run.required !== false) checks.required_failed += 1;
      }
    }
    checks.conclusions = checks.conclusions.slice(0, 64);
    return { checks, errors: [] };
  } catch (error) {
    return {
      checks: emptyChecks(),
      errors: [
        {
          source: 'github-checks',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        },
      ],
    };
  }
}
