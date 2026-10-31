/** 기능별 LLM 사용량 계측 (#1546). 코드에 일일 cap 은 두지 않는다. */

export const LLM_USAGE_FEATURES = [
  'consolidation_summarize',
  'relation_extraction',
  'procedural_extraction',
  'agent_chat',
  'relevance_gate',
  'cluster_judge',
  'directive_recall',
] as const;

export type LlmUsageFeature = (typeof LLM_USAGE_FEATURES)[number];

export type LlmAttemptOutcome = 'success' | 'rate_limited' | 'failure' | 'timeout';

export type LlmAttemptCoverage = 'full' | 'partial' | 'unknown';

export type LlmLogicalFinalPath = 'llm' | 'extractive' | 'skipped' | 'deferred' | 'not_configured';

export type LlmUsageTokenField = number | 'unknown';

export interface LlmUsageAttemptInput {
  logicalRequestId: string;
  attemptIndex: number;
  feature: LlmUsageFeature;
  provider: string;
  model: string;
  outcome: LlmAttemptOutcome;
  failureReason?: string;
  attemptCoverage: LlmAttemptCoverage;
  inputTokens: LlmUsageTokenField;
  outputTokens: LlmUsageTokenField;
  latencyMs?: number;
  runId?: string | null;
  createdAtUtc?: string;
}

export interface LlmUsageLogicalInput {
  logicalRequestId: string;
  feature: LlmUsageFeature;
  provider: string | null;
  model: string | null;
  finalPath: LlmLogicalFinalPath;
  finalReason?: string;
  attemptCount: number;
  rateLimitedCount: number;
  runId?: string | null;
  createdAtUtc?: string;
}

export interface LlmUsageDailyAggregateRow {
  pacificDate: string;
  feature: LlmUsageFeature;
  provider: string;
  model: string;
  outcome: LlmAttemptOutcome;
  attemptCount: number;
  logicalSuccessCount: number;
  inputTokensKnown: number;
  outputTokensKnown: number;
  usageUnknownCount: number;
}

export interface LlmUsageStarvationReport {
  /** 로컬 DB 합계만 반영. 정확한 provider quota 잔량이 아니다. */
  disclaimer: string;
  pacificDates: string[];
  byFeature: Array<{
    feature: LlmUsageFeature;
    successAttempts: number;
    rateLimitedAttempts: number;
    otherFailures: number;
    logicalDeferred: number;
  }>;
  /** 한 feature 의 429 가 다른 feature 성공 attempt 를 0 으로 만든 날짜 (휴리스틱) */
  suspectedStarvationDays: string[];
}
