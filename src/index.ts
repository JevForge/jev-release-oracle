import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadReleaseReport } from './collectors/load.js';
import { loadFileConfig, resolveOracleConfig, validateOracleConfig, type RawActionInputs } from './collectors/config.js';
import { fetchPreviousReleaseBaseline, type ReleaseBaselineClient } from './collectors/github-baseline.js';
import type { BaselineSnapshot } from './collectors/baseline.js';
import type { ChecksClient } from './collectors/checks.js';
import type { CompareClient } from './collectors/github-compare.js';
import type { DeploymentsClient } from './collectors/deployments.js';
import { formatActionMessage, writeDecisionOutputs } from './github/outputs.js';
import { runOracle } from './run.js';
import { safeError } from './utils/redact.js';
import type { CommentClient, ReviewerClient } from './executors/comment.js';
import type { CheckRunClient } from './github/check-run.js';

const LOG = '[JEV Release Oracle]';

const CONFIG_INPUTS = [
  'target_ref',
  'base_ref',
  'signals',
  'signals_path',
  'changelog_path',
  'findings_path',
  'findings',
  'sarif_path',
  'incidents_path',
  'metrics_path',
  'metrics',
  'baseline_path',
  'baseline_mode',
  'sentinel_decision',
  'sentinel_findings',
  'cost_decision',
  'cost_metrics',
  'fetch_github_compare',
  'fetch_checks',
  'fetch_deployments',
  'incident_labels',
  'environment',
  'min_confidence',
  'low_confidence_policy',
  'review_mode',
  'fail_on_warn',
  'source_error_policy',
  'jev_provider',
  'jev_endpoint',
  'jev_model',
  'timeout_ms',
  'max_items_to_jev',
  'comment_on_github',
  'create_check_run',
  'write_report_artifact',
  'request_reviewers',
  'structured_logs',
  'dry_run',
] as const;

function getActionInputs(): RawActionInputs {
  return Object.fromEntries(CONFIG_INPUTS.map(name => [name, core.getInput(name) || undefined]));
}

function resolveApiKey(provider: string): string | undefined {
  if (provider === 'vercel-ai-gateway') return process.env.AI_GATEWAY_API_KEY || undefined;
  if (provider === 'typesafe-native') return process.env.TYPESAFE_API_KEY || undefined;
  return process.env.JEV_CUSTOM_API_KEY || process.env.CUSTOM_JEV_API_KEY || undefined;
}

async function main(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const config = resolveOracleConfig(getActionInputs(), loadFileConfig(workspace));
  validateOracleConfig(config);
  const jevProvider = config.jevProvider;
  const environment = config.environment;
  const lowConfidencePolicy = config.lowConfidencePolicy;
  const reviewMode = config.reviewMode;
  const sourceErrorPolicy = config.sourceErrorPolicy;

  const targetRef =
    config.targetRef ||
    github.context.payload.pull_request?.head?.sha ||
    github.context.sha ||
    'HEAD';
  const baseRef = config.baseRef;
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

  const releaseBaselineClient: ReleaseBaselineClient | null = octokit
    ? {
        async listReleases(o, r) {
          return (await octokit.paginate(octokit.rest.repos.listReleases, {
            owner: o,
            repo: r,
            per_page: 20,
          })).map(release => ({
            tag_name: release.tag_name,
            draft: release.draft,
            prerelease: release.prerelease,
          }));
        },
        async getFileAtRef(o, r, path, ref) {
          try {
            const response = await octokit.rest.repos.getContent({ owner: o, repo: r, path, ref });
            if (Array.isArray(response.data) || response.data.type !== 'file' || !response.data.content) return null;
            return response.data.content.replace(/\s+/g, '');
          } catch (error) {
            const status = (error as { status?: number }).status;
            if (status === 404) return null;
            throw error;
          }
        },
      }
    : null;

  let autoBaseline: { ref: string | null; snapshot?: BaselineSnapshot; error?: string } = {
    ref: null,
  };
  if (config.baselineMode === 'new_only' && !config.baselinePath) {
    autoBaseline = releaseBaselineClient
      ? await fetchPreviousReleaseBaseline({
          owner,
          repo,
          targetRef,
          reportPath: '.jev/release-oracle-report.json',
          client: releaseBaselineClient,
        })
      : { ref: null, error: 'new_only baseline requires a GitHub token or baseline_path' };
  }

  const report = await loadReleaseReport({
    workspace,
    targetRef,
    baseRef,
    environment,
    signalsJson: config.signalsJson,
    signalsPath: config.signalsPath,
    changelogPath: config.changelogPath,
    findingsPath: config.findingsPath,
    findingsJson: config.findingsJson,
    sarifPath: config.sarifPath,
    incidentsPath: config.incidentsPath,
    metricsPath: config.metricsPath,
    metricsJson: config.metricsJson,
    fetchGithubCompare: config.fetchGithubCompare,
    fetchChecks: config.fetchChecks,
    fetchDeployments: config.fetchDeployments,
    incidentLabels: config.incidentLabels,
    sentinelDecision: config.sentinelDecision,
    sentinelFindings: config.sentinelFindings,
    costDecision: config.costDecision,
    costMetrics: config.costMetrics,
    baselinePath: config.baselinePath,
    baselineMode: config.baselineMode,
    baselineSnapshot: autoBaseline.snapshot,
    baselineRef: autoBaseline.ref,
    baselineError: autoBaseline.error,
    owner,
    repo,
    compareClient,
    checksClient,
    deploymentsClient,
  });

  const commentOnGithub = config.commentOnGithub;
  const createCheckRun = config.createCheckRun;
  const writeReportArtifact = config.writeReportArtifact;
  const dryRun = config.dryRun;
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
        async findExistingCheckRun(input) {
          const response = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: input.headSha,
            per_page: 100,
          });
          const existing = response.data.check_runs.find(
            run => run.name === input.name && run.head_sha === input.headSha,
          );
          return existing ? { id: existing.id } : null;
        },
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
        async updateCheckRun(id, input) {
          await octokit.rest.checks.update({
            owner,
            repo,
            check_run_id: id,
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
    minConfidence: config.minConfidence,
    lowConfidencePolicy,
    reviewMode,
    failOnWarn: config.failOnWarn,
    sourceErrorPolicy,
    jevProvider,
    jevEndpoint: config.jevEndpoint,
    jevModel: config.jevModel,
    timeoutMs: config.timeoutMs,
    maxItemsToJev: config.maxItemsToJev,
    apiKey: resolveApiKey(jevProvider),
    commentOnGithub,
    createCheckRun,
    writeReportArtifact,
    requestReviewers: config.requestReviewers,
    structuredLogs: config.structuredLogs,
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
