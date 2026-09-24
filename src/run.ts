import { applyOraclePolicy, floorDecision, type OracleOutcome } from './decision/policy.js';
import { planEffects, type PlannedEffects } from './executors/effects.js';
import {
  maybePostComment,
  maybeRequestReviewers,
  type CommentClient,
  type ReviewerClient,
} from './executors/comment.js';
import { maybeCreateCheckRun, type CheckRunClient } from './github/check-run.js';
import { writeReportArtifacts } from './github/outputs.js';
import { createJevProvider } from './jev/factory.js';
import { buildEvaluationState } from './jev/questions.js';
import type { JevProvider } from './jev/types.js';
import type { JevProviderId, LowConfidencePolicy, ReviewMode, SourceErrorPolicy } from './schemas/enums.js';
import { RunOptionsSchema, type OracleDecision, type ReleaseRiskReport } from './schemas/oracle.js';

export interface RunOracleParams {
  report: ReleaseRiskReport;
  workspace?: string;
  minConfidence: number;
  lowConfidencePolicy: LowConfidencePolicy;
  reviewMode: ReviewMode;
  failOnWarn: boolean;
  sourceErrorPolicy: SourceErrorPolicy;
  jevProvider: JevProviderId;
  jevEndpoint?: string;
  jevModel?: string;
  timeoutMs: number;
  maxItemsToJev: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  provider?: JevProvider;
  commentOnGithub: boolean;
  createCheckRun: boolean;
  writeReportArtifact: boolean;
  requestReviewers?: string;
  structuredLogs: boolean;
  dryRun: boolean;
  headSha?: string | null;
  commentClient?: CommentClient | null;
  checkRunClient?: CheckRunClient | null;
  reviewerClient?: ReviewerClient | null;
  logInfo?: (message: string) => void;
}

export interface RunOracleResult {
  outcome: OracleOutcome;
  decision: OracleDecision;
  effects: PlannedEffects;
  commentStatus: 'posted' | 'updated' | 'dry-run' | 'skipped';
  checkStatus: 'created' | 'dry-run' | 'skipped';
  reviewerStatus: 'requested' | 'dry-run' | 'skipped';
  reportMarkdownFile: string | null;
  reportJsonFile: string | null;
}

export async function runOracle(params: RunOracleParams): Promise<RunOracleResult> {
  const options = RunOptionsSchema.parse({
    min_confidence: params.minConfidence,
    low_confidence_policy: params.lowConfidencePolicy,
    review_mode: params.reviewMode,
    fail_on_warn: params.failOnWarn,
    source_error_policy: params.sourceErrorPolicy,
    jev_provider: params.jevProvider,
    timeout_ms: params.timeoutMs,
    max_items_to_jev: params.maxItemsToJev,
    comment_on_github: params.commentOnGithub,
    create_check_run: params.createCheckRun,
    write_report_artifact: params.writeReportArtifact,
    request_reviewers: params.requestReviewers,
    structured_logs: params.structuredLogs,
    dry_run: params.dryRun,
  });

  const floor = floorDecision(params.report);
  const state = buildEvaluationState(params.report, floor, options.max_items_to_jev);
  const provider =
    params.provider ??
    createJevProvider({
      provider: params.jevProvider,
      apiKey: params.apiKey,
      endpoint: params.jevEndpoint,
      model: params.jevModel,
      timeoutMs: options.timeout_ms,
      fetchImpl: params.fetchImpl,
    });

  const jev = await provider.evaluateRelease(state);
  const outcome = applyOraclePolicy({
    report: params.report,
    jev,
    minConfidence: options.min_confidence,
    lowConfidencePolicy: options.low_confidence_policy,
    sourceErrorPolicy: options.source_error_policy,
    reviewMode: options.review_mode,
    failOnWarn: options.fail_on_warn,
  });

  const wantReviewers =
    Boolean(options.request_reviewers?.trim()) &&
    (outcome.decision.decision === 'hold' ||
      outcome.decision.decision === 'review' ||
      outcome.status === 'request-review');

  const effects = planEffects({
    decision: outcome.decision,
    actionStatus: outcome.status,
    comment: options.comment_on_github,
    checkRun: options.create_check_run,
    writeReport: options.write_report_artifact,
    requestReviewers: wantReviewers,
  });

  const commentStatus = await maybePostComment(
    options.comment_on_github,
    options.dry_run,
    outcome.decision,
    params.commentClient ?? null,
  );

  const checkStatus = await maybeCreateCheckRun(
    options.create_check_run,
    options.dry_run,
    params.headSha ?? null,
    outcome.decision,
    outcome.status,
    params.checkRunClient ?? null,
  );

  const reviewerStatus = await maybeRequestReviewers(
    wantReviewers,
    options.dry_run,
    options.request_reviewers,
    params.reviewerClient ?? null,
  );

  let reportMarkdownFile: string | null = null;
  let reportJsonFile: string | null = null;
  if (options.write_report_artifact && params.workspace && !options.dry_run) {
    const written = writeReportArtifacts(params.workspace, outcome.decision);
    reportMarkdownFile = written.markdownPath;
    reportJsonFile = written.jsonPath;
  }

  if (options.structured_logs && params.logInfo) {
    params.logInfo(
      JSON.stringify({
        event: 'jev_release_oracle',
        decision: outcome.decision.decision,
        confidence: outcome.decision.confidence,
        provisional: outcome.decision.provisional,
        jev_status: outcome.decision.jev_status,
        policy_floor: outcome.decision.policy_floor,
        held: outcome.decision.held,
        reason_codes: outcome.decision.reason_codes,
      }),
    );
  }

  return {
    outcome,
    decision: outcome.decision,
    effects,
    commentStatus,
    checkStatus,
    reviewerStatus,
    reportMarkdownFile,
    reportJsonFile,
  };
}
