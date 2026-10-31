import type { LlmAttemptCoverage, LlmAttemptOutcome, LlmUsageTokenField } from './llm-usage-types.js';
import { getLlmUsageLogicalContext } from './llm-usage-logical-context.js';
import type { LlmUsageRepository } from './llm-usage-repository.js';
import type { LlmLogicalFinalPath } from './llm-usage-types.js';

let repository: LlmUsageRepository | null = null;

function logLlmUsageRecordFailure(kind: 'attempt' | 'logical', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[LLM_USAGE] failed to persist ${kind}: ${message.slice(0, 200)}\n`);
}

export function setLlmUsageRepository(repo: LlmUsageRepository | null): void {
  repository = repo;
}

export function recordLlmUsageAttempt(params: {
  provider: string;
  model: string;
  outcome: LlmAttemptOutcome;
  failureReason?: string;
  attemptCoverage: LlmAttemptCoverage;
  inputTokens: LlmUsageTokenField;
  outputTokens: LlmUsageTokenField;
  latencyMs?: number;
}): void {
  const repo = repository;
  const ctx = getLlmUsageLogicalContext();
  if (!repo || !ctx) {
    return;
  }
  ctx.attemptCounter.value += 1;
  if (params.outcome === 'rate_limited') {
    ctx.rateLimitedCounter.value += 1;
  }
  try {
    repo.insertAttempt({
      logicalRequestId: ctx.logicalRequestId,
      attemptIndex: ctx.attemptCounter.value,
      feature: ctx.feature,
      provider: params.provider,
      model: params.model,
      outcome: params.outcome,
      failureReason: params.failureReason,
      attemptCoverage: params.attemptCoverage,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      latencyMs: params.latencyMs,
      runId: ctx.runId,
    });
  } catch (error) {
    logLlmUsageRecordFailure('attempt', error);
  }
}

export function recordLlmUsageLogicalFinal(params: {
  finalPath: LlmLogicalFinalPath;
  finalReason?: string;
  provider?: string | null;
  model?: string | null;
}): void {
  const repo = repository;
  const ctx = getLlmUsageLogicalContext();
  if (!repo || !ctx) {
    return;
  }
  try {
    repo.insertLogical({
      logicalRequestId: ctx.logicalRequestId,
      feature: ctx.feature,
      provider: params.provider ?? null,
      model: params.model ?? null,
      finalPath: params.finalPath,
      finalReason: params.finalReason,
      attemptCount: ctx.attemptCounter.value,
      rateLimitedCount: ctx.rateLimitedCounter.value,
      runId: ctx.runId,
    });
  } catch (error) {
    logLlmUsageRecordFailure('logical', error);
  }
}
