import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { pacificDateFromUtcIso } from './llm-usage-pacific-date.js';
import type {
  LlmUsageAttemptInput,
  LlmUsageDailyAggregateRow,
  LlmUsageLogicalInput,
  LlmUsageStarvationReport,
} from './llm-usage-types.js';
import { LLM_USAGE_FEATURES } from './llm-usage-types.js';

function tokenToSql(value: number | 'unknown'): number | null {
  return value === 'unknown' ? null : value;
}

export class LlmUsageRepository {
  constructor(private readonly db: Database.Database) {}

  insertAttempt(input: LlmUsageAttemptInput): void {
    const createdAt = input.createdAtUtc ?? new Date().toISOString();
    const pacificDate = pacificDateFromUtcIso(createdAt);
    const usageUnknown =
      input.inputTokens === 'unknown' || input.outputTokens === 'unknown' ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO llm_usage_attempt (
          id, logical_request_id, attempt_index, feature, provider, model,
          outcome, failure_reason, attempt_coverage,
          input_tokens, output_tokens, usage_unknown, latency_ms, run_id,
          pacific_date, created_at
        ) VALUES (
          @id, @logicalRequestId, @attemptIndex, @feature, @provider, @model,
          @outcome, @failureReason, @attemptCoverage,
          @inputTokens, @outputTokens, @usageUnknown, @latencyMs, @runId,
          @pacificDate, @createdAt
        )`,
      )
      .run({
        id: randomUUID(),
        logicalRequestId: input.logicalRequestId,
        attemptIndex: input.attemptIndex,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        outcome: input.outcome,
        failureReason: input.failureReason ?? null,
        attemptCoverage: input.attemptCoverage,
        inputTokens: tokenToSql(input.inputTokens),
        outputTokens: tokenToSql(input.outputTokens),
        usageUnknown,
        latencyMs: input.latencyMs ?? null,
        runId: input.runId ?? null,
        pacificDate,
        createdAt,
      });
  }

  insertLogical(input: LlmUsageLogicalInput): void {
    const createdAt = input.createdAtUtc ?? new Date().toISOString();
    const pacificDate = pacificDateFromUtcIso(createdAt);
    this.db
      .prepare(
        `INSERT INTO llm_usage_logical (
          id, logical_request_id, feature, provider, model,
          final_path, final_reason, attempt_count, rate_limited_count, run_id,
          pacific_date, created_at
        ) VALUES (
          @id, @logicalRequestId, @feature, @provider, @model,
          @finalPath, @finalReason, @attemptCount, @rateLimitedCount, @runId,
          @pacificDate, @createdAt
        )`,
      )
      .run({
        id: randomUUID(),
        logicalRequestId: input.logicalRequestId,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        finalPath: input.finalPath,
        finalReason: input.finalReason ?? null,
        attemptCount: input.attemptCount,
        rateLimitedCount: input.rateLimitedCount,
        runId: input.runId ?? null,
        pacificDate,
        createdAt,
      });
  }

  queryDailyAggregates(pacificDateFrom: string, pacificDateTo: string): LlmUsageDailyAggregateRow[] {
    const rows = this.db
      .prepare(
        `SELECT
          a.pacific_date AS pacificDate,
          a.feature,
          a.provider,
          a.model,
          a.outcome,
          COUNT(*) AS attemptCount,
          SUM(CASE WHEN a.usage_unknown = 1 THEN 1 ELSE 0 END) AS usageUnknownCount,
          SUM(COALESCE(a.input_tokens, 0)) AS inputTokensKnown,
          SUM(COALESCE(a.output_tokens, 0)) AS outputTokensKnown
        FROM llm_usage_attempt a
        WHERE a.pacific_date >= @from AND a.pacific_date <= @to
        GROUP BY a.pacific_date, a.feature, a.provider, a.model, a.outcome
        ORDER BY a.pacific_date, a.feature, a.provider, a.model, a.outcome`,
      )
      .all({ from: pacificDateFrom, to: pacificDateTo }) as Array<{
      pacificDate: string;
      feature: LlmUsageDailyAggregateRow['feature'];
      provider: string;
      model: string;
      outcome: LlmUsageDailyAggregateRow['outcome'];
      attemptCount: number;
      usageUnknownCount: number;
      inputTokensKnown: number;
      outputTokensKnown: number;
    }>;

    const logicalSuccess = this.db
      .prepare(
        `SELECT pacific_date AS pacificDate, feature, COUNT(*) AS c
         FROM llm_usage_logical
         WHERE final_path = 'llm' AND pacific_date >= @from AND pacific_date <= @to
         GROUP BY pacific_date, feature`,
      )
      .all({ from: pacificDateFrom, to: pacificDateTo }) as Array<{
      pacificDate: string;
      feature: LlmUsageDailyAggregateRow['feature'];
      c: number;
    }>;
    const successMap = new Map(logicalSuccess.map((r) => [`${r.pacificDate}:${r.feature}`, r.c]));

    return rows.map((r) => ({
      pacificDate: r.pacificDate,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      outcome: r.outcome,
      attemptCount: r.attemptCount,
      logicalSuccessCount: successMap.get(`${r.pacificDate}:${r.feature}`) ?? 0,
      inputTokensKnown: r.inputTokensKnown,
      outputTokensKnown: r.outputTokensKnown,
      usageUnknownCount: r.usageUnknownCount,
    }));
  }

  buildStarvationReport(pacificDateFrom: string, pacificDateTo: string): LlmUsageStarvationReport {
    const disclaimer =
      '로컬 합계만 반영. 다른 클라이언트·프로젝트의 호출과 provider quota 잔량은 포함하지 않는다.';
    const dates = this.db
      .prepare(
        `SELECT DISTINCT pacific_date AS d FROM llm_usage_attempt
         WHERE pacific_date >= @from AND pacific_date <= @to ORDER BY d`,
      )
      .all({ from: pacificDateFrom, to: pacificDateTo }) as Array<{ d: string }>;

    const byFeature = LLM_USAGE_FEATURES.map((feature) => {
      const attempts = this.db
        .prepare(
          `SELECT outcome, COUNT(*) AS c FROM llm_usage_attempt
           WHERE feature = @feature AND pacific_date >= @from AND pacific_date <= @to
           GROUP BY outcome`,
        )
        .all({ feature, from: pacificDateFrom, to: pacificDateTo }) as Array<{
        outcome: string;
        c: number;
      }>;
      const map = Object.fromEntries(attempts.map((a) => [a.outcome, a.c]));
      const deferred = this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM llm_usage_logical
           WHERE feature = @feature AND final_path = 'deferred'
           AND pacific_date >= @from AND pacific_date <= @to`,
        )
        .get({ feature, from: pacificDateFrom, to: pacificDateTo }) as { c: number };
      return {
        feature,
        successAttempts: map.success ?? 0,
        rateLimitedAttempts: map.rate_limited ?? 0,
        otherFailures: (map.failure ?? 0) + (map.timeout ?? 0),
        logicalDeferred: deferred.c,
      };
    });

    const suspectedStarvationDays: string[] = [];
    for (const { d } of dates) {
      const perFeature = this.db
        .prepare(
          `SELECT feature,
            SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN outcome = 'rate_limited' THEN 1 ELSE 0 END) AS rl
           FROM llm_usage_attempt WHERE pacific_date = @d GROUP BY feature`,
        )
        .all({ d }) as Array<{ feature: string; success: number; rl: number }>;
      const with429 = perFeature.filter((f) => f.rl > 0);
      const starved = perFeature.filter((f) => f.success === 0 && f.rl === 0);
      if (with429.length > 0 && starved.some((s) => with429.some((w) => w.feature !== s.feature))) {
        suspectedStarvationDays.push(d);
      }
    }

    return {
      disclaimer,
      pacificDates: dates.map((x) => x.d),
      byFeature,
      suspectedStarvationDays,
    };
  }
}
