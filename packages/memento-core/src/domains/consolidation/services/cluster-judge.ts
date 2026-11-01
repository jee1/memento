/**
 * #1225: second opinion on consolidation clusters. MiniLM cosine similarity groups records of
 * the same genre (e.g. two unrelated work logs) above the cluster threshold; a judge model
 * decides whether two texts cover the same task or topic.
 *
 * This fetch stays private. SystemOneClient retries a WAF block with fences removed, and
 * that retry would change consolidation scores.
 */
import { logger } from '../../../shared/utils/logger.js';
import { isClusterJudgeEnabled } from '../../../shared/config/cluster-judge-config.js';
import { stripMemoryTemplateLabels } from '../../../shared/utils/template-label-normalizer.js';
import { classifyLlmAttemptOutcome } from '../../../shared/services/llm-usage/llm-usage-classify.js';
import { recordLlmUsageAttempt } from '../../../shared/services/llm-usage/llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from '../../../shared/services/llm-usage/llm-usage-logical-context.js';

export interface ClusterJudgePair {
  a: string;
  b: string;
}

export interface IClusterJudge {
  /** One P(same task or topic) per pair, in order. Never throws; NaN where no score was obtained. */
  scorePairs(pairs: ClusterJudgePair[]): Promise<number[]>;
}

const QUESTION = '기억 A 와 기억 B 는 같은 작업이나 같은 주제를 다룬다';
const BATCH_SIZE = 10;
const TEXT_CHARS = 400;

interface JevClusterJudgeOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class JevClusterJudge implements IClusterJudge {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: JevClusterJudgeOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'jev-latest';
    this.baseUrl = options.baseUrl ?? 'https://api.typesafe.ai/v1/systemone';
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async scorePairs(pairs: ClusterJudgePair[]): Promise<number[]> {
    return runWithLlmUsageLogicalContext('cluster_judge', null, async () => {
      const scores: number[] = [];
      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        scores.push(...(await this.scoreBatch(pairs.slice(i, i + BATCH_SIZE))));
      }
      return scores;
    });
  }

  private async scoreBatch(batch: ClusterJudgePair[]): Promise<number[]> {
    const state: Record<string, string> = {};
    const questions: Record<string, { type: 'noul'; instructions: string }> = {};
    batch.forEach((pair, k) => {
      state[`a${k}`] = stripMemoryTemplateLabels(pair.a).slice(0, TEXT_CHARS);
      state[`b${k}`] = stripMemoryTemplateLabels(pair.b).slice(0, TEXT_CHARS);
      questions[`q${k}`] = { type: 'noul', instructions: `${QUESTION} (기억 A = a${k}, 기억 B = b${k})` };
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: controller.signal
      });
      if (!res.ok) {
        recordLlmUsageAttempt({
          provider: 'typesafe',
          model: this.model,
          outcome: res.status === 429 ? 'rate_limited' : 'failure',
          failureReason: `http_${res.status}`,
          attemptCoverage: 'full',
          inputTokens: 'unknown',
          outputTokens: 'unknown',
        });
        logger.warn(`Consolidation judge: request failed (status ${res.status}, pairs ${batch.length})`);
        return batch.map(() => Number.NaN);
      }
      recordLlmUsageAttempt({
        provider: 'typesafe',
        model: this.model,
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      const data = (await res.json()) as { answers?: Record<string, { noul?: unknown }> };
      return batch.map((_, k) => {
        const noul = data.answers?.[`q${k}`]?.noul;
        return typeof noul === 'number' ? noul : Number.NaN;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordLlmUsageAttempt({
        provider: 'typesafe',
        model: this.model,
        outcome: classifyLlmAttemptOutcome(error),
        failureReason: message.slice(0, 120),
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      logger.warn(`Consolidation judge: ${message} (pairs ${batch.length})`);
      return batch.map(() => Number.NaN);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createClusterJudge(apiKey: string | undefined, model: string | undefined): IClusterJudge | null {
  if (!isClusterJudgeEnabled()) {
    return null;
  }
  if (!apiKey || apiKey.trim() === '') {
    logger.error('CONSOLIDATION_JUDGE=typesafe but TYPESAFE_API_KEY is empty; consolidation runs without the judge.');
    return null;
  }
  return new JevClusterJudge({ apiKey, model: model || undefined });
}
