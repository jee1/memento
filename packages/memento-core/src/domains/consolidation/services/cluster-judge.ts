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
import { hashMemoryContent } from '../../../shared/utils/memory-content-hash.js';

export interface ClusterJudgePair {
  a: string;
  b: string;
}

export interface ClusterJudgeScore {
  score: number;
  cacheHit: boolean;
}

export interface IClusterJudge {
  /** One P(same task or topic) per pair, in order. Never throws; NaN where no score was obtained. */
  scorePairs(pairs: ClusterJudgePair[]): Promise<ClusterJudgeScore[]>;
}

const QUESTION = '기억 A 와 기억 B 는 같은 작업이나 같은 주제를 다룬다';
const BATCH_SIZE = 10;
const TEXT_CHARS = 400;
/** Bump when QUESTION, TEXT_CHARS or the label stripping changes, so cached scores are not reused. */
const PROMPT_VERSION = 1;
/**
 * #1668: production saw 2,012 distinct pairs in 36h (~1,340/day). 10,000 covers about a week,
 * the time between deploys, in about 3 MB of heap.
 */
const SCORE_CACHE_MAX_ENTRIES = 10_000;

interface JevClusterJudgeOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  scoreCache?: Map<string, number>;
  scoreCacheMaxEntries?: number;
}

export class JevClusterJudge implements IClusterJudge {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  // ponytail: process memory only, so the first run after a restart (weekly deploy) re-judges
  // every pair once. Move it to a table with the same key if that run's cost starts to matter.
  private readonly scoreCache: Map<string, number>;
  private readonly scoreCacheMaxEntries: number;

  constructor(options: JevClusterJudgeOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'jev-latest';
    this.baseUrl = options.baseUrl ?? 'https://api.typesafe.ai/v1/systemone';
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.scoreCache = options.scoreCache ?? new Map();
    this.scoreCacheMaxEntries = options.scoreCacheMaxEntries ?? SCORE_CACHE_MAX_ENTRIES;
  }

  /**
   * #1668: rejected members stay unconsolidated and come back every hourly run with the same
   * content, so a pair is judged once per (content, model, prompt) and its score reused.
   * The threshold is applied by the caller, so changing it needs no invalidation.
   */
  async scorePairs(pairs: ClusterJudgePair[]): Promise<ClusterJudgeScore[]> {
    const keys = pairs.map(pair => this.cacheKey(pair));
    const cached = keys.map(key => this.readCachedScore(key));
    const misses = pairs.filter((_, i) => cached[i] === undefined);
    const fresh = misses.length > 0 ? await this.judgePairs(misses) : [];
    let k = 0;
    return cached.map((hit, i) => {
      if (hit !== undefined) {
        return { score: hit, cacheHit: true };
      }
      const score = fresh[k++]!;
      if (Number.isFinite(score)) {
        this.writeCachedScore(keys[i]!, score);
      }
      return { score, cacheHit: false };
    });
  }

  private cacheKey(pair: ClusterJudgePair): string {
    return `${this.model}:${PROMPT_VERSION}:${hashMemoryContent(pair.a)}:${hashMemoryContent(pair.b)}`;
  }

  private readCachedScore(key: string): number | undefined {
    const score = this.scoreCache.get(key);
    if (score !== undefined) {
      this.scoreCache.delete(key);
      this.scoreCache.set(key, score);
    }
    return score;
  }

  private writeCachedScore(key: string, score: number): void {
    if (!this.scoreCache.has(key) && this.scoreCache.size >= this.scoreCacheMaxEntries) {
      const oldestKey = this.scoreCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.scoreCache.delete(oldestKey);
      }
    }
    this.scoreCache.set(key, score);
  }

  private async judgePairs(pairs: ClusterJudgePair[]): Promise<number[]> {
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
