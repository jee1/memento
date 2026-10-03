/**
 * #1225: second opinion on consolidation clusters. MiniLM cosine similarity groups records of
 * the same genre (e.g. two unrelated work logs) above the cluster threshold; a judge model
 * decides whether two texts cover the same task or topic.
 */
import { logger } from '../../../shared/utils/logger.js';
import { stripMemoryTemplateLabels } from './template-label-normalizer.js';

export interface ClusterJudgePair {
  a: string;
  b: string;
}

export interface IClusterJudge {
  /** One P(same task or topic) per pair, in order. Never throws; NaN where no score was obtained. */
  scorePairs(pairs: ClusterJudgePair[]): Promise<number[]>;
}

/** 40 labeled production pairs (2026-10-03): 0.6 kept 14/15 same-topic and 0/25 different-topic pairs. */
export function getClusterJudgeThreshold(): number {
  const raw = process.env.CONSOLIDATION_JUDGE_THRESHOLD;
  const n = raw ? parseFloat(raw) : 0.6;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.6;
}

const QUESTION = '기억 A 와 기억 B 는 같은 작업이나 같은 주제를 다룬다';
const BATCH_SIZE = 10;
const TEXT_CHARS = 400;

export interface JevClusterJudgeOptions {
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
    const scores: number[] = [];
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      scores.push(...(await this.scoreBatch(pairs.slice(i, i + BATCH_SIZE))));
    }
    return scores;
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
        logger.warn(`Consolidation judge: request failed (status ${res.status}, pairs ${batch.length})`);
        return batch.map(() => Number.NaN);
      }
      const data = (await res.json()) as { answers?: Record<string, { noul?: unknown }> };
      return batch.map((_, k) => {
        const noul = data.answers?.[`q${k}`]?.noul;
        return typeof noul === 'number' ? noul : Number.NaN;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Consolidation judge: ${message} (pairs ${batch.length})`);
      return batch.map(() => Number.NaN);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** CONSOLIDATION_JUDGE=typesafe enables the judge; anything else keeps cosine-only clustering. */
export function createClusterJudge(apiKey: string | undefined, model: string | undefined): IClusterJudge | null {
  if (process.env.CONSOLIDATION_JUDGE !== 'typesafe') {
    return null;
  }
  if (!apiKey || apiKey.trim() === '') {
    logger.error('CONSOLIDATION_JUDGE=typesafe but TYPESAFE_API_KEY is empty; consolidation runs without the judge.');
    return null;
  }
  return new JevClusterJudge({ apiKey, model: model || undefined });
}
