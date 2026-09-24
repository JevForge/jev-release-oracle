import type { DeployState } from '../schemas/enums.js';
import type { DeploymentSummary, SourceError } from '../schemas/oracle.js';
import { emptyDeployments } from './signals.js';
import { sanitizeText } from '../utils/redact.js';

export interface DeploymentsClient {
  listDeployments(
    owner: string,
    repo: string,
    environment: string,
  ): Promise<Array<{ id: number; environment?: string; sha?: string }>>;
  getStatuses(
    owner: string,
    repo: string,
    deploymentId: number,
  ): Promise<Array<{ state?: string }>>;
}

function mapState(value: string | undefined): DeployState {
  const raw = (value ?? 'unknown').toLowerCase();
  const allowed: DeployState[] = ['success', 'failure', 'pending', 'inactive', 'error', 'unknown'];
  return (allowed.includes(raw as DeployState) ? raw : 'unknown') as DeployState;
}

export async function fetchDeployments(input: {
  client: DeploymentsClient;
  owner: string;
  repo: string;
  environment: string;
}): Promise<{ deployments: DeploymentSummary; errors: SourceError[] }> {
  try {
    const deployments = await input.client.listDeployments(input.owner, input.repo, input.environment);
    const summary = emptyDeployments();
    const errors: SourceError[] = [];
    for (const deployment of deployments.slice(0, 20)) {
      summary.total += 1;
      let statuses: Array<{ state?: string }>;
      try {
        statuses = await input.client.getStatuses(input.owner, input.repo, deployment.id);
      } catch (error) {
        errors.push({
          source: 'github-deployments',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        });
        continue;
      }
      const latest = statuses[0];
      const state = mapState(latest?.state);
      if (state === 'success') summary.success += 1;
      else if (state === 'pending') summary.pending += 1;
      else if (state === 'failure' || state === 'error') summary.failure += 1;
      summary.latest_state = state;
    }
    return { deployments: summary, errors };
  } catch (error) {
    return {
      deployments: emptyDeployments(),
      errors: [
        {
          source: 'github-deployments',
          message: sanitizeText(error instanceof Error ? error.message : String(error), 400),
        },
      ],
    };
  }
}
