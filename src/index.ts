import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadReleaseReport } from './collectors/load.js';
import type { ChecksClient } from './collectors/checks.js';
import type { CompareClient } from './collectors/github-compare.js';
import type { DeploymentsClient } from './collectors/deployments.js';
import {
  ENVIRONMENTS,
  JEV_PROVIDERS,
  LOW_CONFIDENCE_POLICIES,
  REVIEW_MODES,
  SOURCE_ERROR_POLICIES,
  type EnvironmentName,
  type JevProviderId,
  type LowConfidencePolicy,
  type ReviewMode,
  type SourceErrorPolicy,
} from './schemas/enums.js';
import { formatActionMessage, writeDecisionOutputs } from './github/outputs.js';
import { runOracle } from './run.js';
import { safeError } from './utils/redact.js';
import type { CommentClient, ReviewerClient } from './executors/comment.js';
import type { CheckRunClient } from './github/check-run.js';

const LOG = '[JEV Release Oracle]';

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name);
  if (!raw) return fallback;
  return raw.toLowerCase() === 'true';
}

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
  fallback: T,
): T {
  const raw = value?.trim();
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${LOG} Invalid ${label}: ${raw}`);
}

function resolveApiKey(provider: string): string | undefined {
  if (provider === 'vercel-ai-gateway') return process.env.AI_GATEWAY_API_KEY || undefined;
  if (provider === 'typesafe-native') return process.env.TYPESAFE_API_KEY || undefined;
  return process.env.JEV_CUSTOM_API_KEY || process.env.CUSTOM_JEV_API_KEY || undefined;
}

async function main(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const jevProvider = pickEnum(
    core.getInput('jev_provider') || undefined,
    JEV_PROVIDERS,
    'jev_provider',
    'vercel-ai-gateway',
  ) as JevProviderId;
  const environment = pickEnum(
    core.getInput('environment') || undefined,
    ENVIRONMENTS,
    'environment',
    'production',
  ) as EnvironmentName;
  const lowConfidencePolicy = pickEnum(
    core.getInput('low_confidence_policy') || undefined,
    LOW_CONFIDENCE_POLICIES,
    'low_confidence_policy',
    'fail',
  ) as LowConfidencePolicy;
  const reviewMode = pickEnum(
    core.getInput('review_mode') || undefined,
    REVIEW_MODES,
    'review_mode',
    'fail',
  ) as ReviewMode;
  const sourceErrorPolicy = pickEnum(
    core.getInput('source_error_policy') || undefined,
    SOURCE_ERROR_POLICIES,
    'source_error_policy',
    'fail',
  ) as SourceErrorPolicy;

  const targetRef =
    core.getInput('target_ref').trim() ||
    github.context.payload.pull_request?.head?.sha ||
    github.context.sha ||
    'HEAD';
  const baseRef = core.getInput('base_ref').trim() || null;
  const token = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
  const octokit = token ? github.getOctokit(token) : null;
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  core.info(`${LOG} Jev provider: ${jevProvider}`);
  core.info(
    `${LOG} Data sent to Jev: release risk counts, check/deploy summaries, changelog flags, and a bounded sample of commits/findings/incidents/metrics. Tokens and secrets are not sent.`,
  );

  const compareClient: CompareClient | null = octokit
    ? {
        async compareCommits(o, r, base, head) {
          const response = await octokit.rest.repos.compareCommits({
            owner: o,
            repo: r,
            base,
            head,
            per_page: 100,
          });
          return {
            commits: (response.data.commits ?? []).map(commit => ({
              sha: commit.sha,
              commit: {
                message: commit.commit.message,
                author: commit.commit.author?.name
                  ? { name: commit.commit.author.name }
                  : undefined,
              },
            })),
          };
        },
        async listAssociatedPulls(o, r, commitSha) {
          const response = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
            owner: o,
            repo: r,
            commit_sha: commitSha,
            per_page: 20,
          });
          return response.data.map(pull => ({
            number: pull.number,
            title: pull.title,
            draft: pull.draft ?? false,
            labels: (pull.labels ?? []).map(label => ({
              name: typeof label === 'string' ? label : label.name,
            })),
          }));
        },
      }
    : null;

  const checksClient: ChecksClient | null = octokit
    ? {
        async listCheckRunsForRef(o, r, ref) {
          const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
            owner: o,
            repo: r,
            ref,
            per_page: 100,
          });
          return runs.map(run => ({
            name: run.name,
            conclusion: run.conclusion,
            status: run.status,
          }));
        },
      }
    : null;

  const deploymentsClient: DeploymentsClient | null = octokit
    ? {
        async listDeployments(o, r, environmentName) {
          const response = await octokit.rest.repos.listDeployments({
            owner: o,
            repo: r,
            environment: environmentName,
            per_page: 20,
          });
          return response.data.map(deployment => ({
            id: deployment.id,
            environment: deployment.environment ?? undefined,
            sha: deployment.sha ?? undefined,
          }));
        },
        async getStatuses(o, r, deploymentId) {
          const response = await octokit.rest.repos.listDeploymentStatuses({
            owner: o,
            repo: r,
            deployment_id: deploymentId,
            per_page: 10,
          });
          return response.data.map(status => ({ state: status.state }));
        },
      }
    : null;

  const incidentLabels = core
    .getInput('incident_labels')
    .split(/[,\n]+/)
    .map(part => part.trim())
    .filter(Boolean);

  const report = await loadReleaseReport({
    workspace,
    targetRef,
    baseRef,
    environment,
    signalsJson: core.getInput('signals') || undefined,
    signalsPath: core.getInput('signals_path') || undefined,
    changelogPath: core.getInput('changelog_path') || undefined,
    findingsPath: core.getInput('findings_path') || undefined,
    sarifPath: core.getInput('sarif_path') || undefined,
    incidentsPath: core.getInput('incidents_path') || undefined,
    metricsPath: core.getInput('metrics_path') || undefined,
    fetchGithubCompare: optionalBoolean('fetch_github_compare', true),
    fetchChecks: optionalBoolean('fetch_checks', true),
    fetchDeployments: optionalBoolean('fetch_deployments', false),
    incidentLabels,
    owner,
    repo,
    compareClient,
    checksClient,
    deploymentsClient,
  });

  const commentOnGithub = optionalBoolean('comment_on_github', false);
  const createCheckRun = optionalBoolean('create_check_run', true);
  const writeReportArtifact = optionalBoolean('write_report_artifact', false);
  const dryRun = optionalBoolean('dry_run', false);
  const issueNumber = github.context.payload.pull_request?.number ?? github.context.issue?.number;

  const commentClient: CommentClient | null =
    commentOnGithub && !dryRun && octokit && issueNumber
      ? {
          async listComments() {
            const comments = await octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: issueNumber,
              per_page: 100,
            });
            return comments.data.map(comment => ({ id: comment.id, body: comment.body ?? '' }));
          },
          async createComment(body: string) {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body,
            });
          },
          async updateComment(id: number, body: string) {
            await octokit.rest.issues.updateComment({
              owner,
              repo,
              comment_id: id,
              body,
            });
          },
        }
      : null;

  const checkRunClient: CheckRunClient | null = octokit
    ? {
        async createCheckRun(input) {
          await octokit.rest.checks.create({
            owner,
            repo,
            name: input.name,
            head_sha: input.headSha,
            status: 'completed',
            conclusion: input.conclusion,
            output: {
              title: input.title,
              summary: input.summary,
            },
          });
        },
      }
    : null;

  const reviewerClient: ReviewerClient | null =
    octokit && issueNumber && github.context.payload.pull_request
      ? {
          async requestReviewers(logins: string[]) {
            await octokit.rest.pulls.requestReviewers({
              owner,
              repo,
              pull_number: issueNumber,
              reviewers: logins,
            });
          },
        }
      : null;

  const result = await runOracle({
    report,
    workspace,
    minConfidence: Number(core.getInput('min_confidence') || 0.75),
    lowConfidencePolicy,
    reviewMode,
    failOnWarn: optionalBoolean('fail_on_warn', false),
    sourceErrorPolicy,
    jevProvider,
    jevEndpoint: core.getInput('jev_endpoint') || undefined,
    jevModel: core.getInput('jev_model') || undefined,
    timeoutMs: Number(core.getInput('timeout_ms') || 45_000),
    maxItemsToJev: Number(core.getInput('max_items_to_jev') || 40),
    apiKey: resolveApiKey(jevProvider),
    commentOnGithub,
    createCheckRun,
    writeReportArtifact,
    requestReviewers: core.getInput('request_reviewers') || undefined,
    structuredLogs: optionalBoolean('structured_logs', false),
    dryRun,
    headSha: targetRef,
    commentClient,
    checkRunClient,
    reviewerClient,
    logInfo: message => core.info(message),
  });

  writeDecisionOutputs(
    {
      setOutput: (name, value) => core.setOutput(name, value),
      setFailed: message => core.setFailed(message),
      warning: message => core.warning(message),
      info: message => core.info(message),
    },
    result.decision,
    result.outcome.status,
    {
      checkStatus: result.checkStatus,
      reportMarkdownFile: result.reportMarkdownFile,
      reportJsonFile: result.reportJsonFile,
    },
  );

  await core.summary.addRaw(result.decision.explanation).write();
  core.info(`${LOG} Comment: ${result.commentStatus}`);
  core.info(`${LOG} Check run: ${result.checkStatus}`);
  core.info(`${LOG} Reviewers: ${result.reviewerStatus}`);
  core.info(`${LOG} Effects: ${result.effects.effects.join(', ')}`);
}

main().catch(error => {
  const message = safeError(error);
  core.setFailed(message.startsWith(LOG) ? message : formatActionMessage(message));
});
