/**
 * TypeSafe Jev(System One) API 기반 관련성 기각 게이트 어댑터.
 * 검색 후보가 질의에 대한 유효한 맥락/답을 담고 있는지 P(true)를 배치 1회 호출로 판정한다.
 * #1095
 */

import type { IRelevanceGatePort } from '../../ports/relevance-gate-port.js';
import { logger } from '../../../../shared/utils/logger.js';

export interface JevRelevanceGateOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  docChars?: number;
}

type JevAnswer = {
  type?: unknown;
  noul?: unknown;
};

type JevResponse = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function nanScores(length: number): number[] {
  return Array.from({ length }, () => Number.NaN);
}

function buildNoulInstructions(candidateId: string, query: string): string {
  return `후보 ${candidateId} 가 질의 "${query}" 에 대한 유효한 맥락이나 답을 담고 있다`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

async function readResponseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export class JevRelevanceGate implements IRelevanceGatePort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly docChars: number;

  constructor(options: JevRelevanceGateOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'jev-latest';
    this.baseUrl = options.baseUrl ?? 'https://api.typesafe.ai/v1/systemone';
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.docChars = options.docChars ?? 300;
  }

  /**
   * 절대 예외를 던지지 않는다. 게이트 장애가 검색 실패로 번지면 안 되므로 fail-open으로
   * 모든 실패는 Number.NaN 배열로 표현한다.
   */
  async score(query: string, docs: string[]): Promise<number[]> {
    if (docs.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    const candidateIds = docs.map((_, index) => `c${index}`);
    const state: Record<string, string> = { query };
    const questions: Record<string, { type: 'noul'; instructions: string }> = {};

    for (const [index, doc] of docs.entries()) {
      const candidateId = `c${index}`;
      state[candidateId] = doc.slice(0, this.docChars);
      questions[candidateId] = {
        type: 'noul',
        instructions: buildNoulInstructions(candidateId, query),
      };
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          state,
          questions,
        }),
        signal: controller.signal,
      });

      const elapsedMs = Date.now() - startedAt;

      if (!res.ok) {
        const body = await readResponseJson(res);

        if (res.status === 403 && !(isRecord(body) && 'detail' in body)) {
          logger.warn(
            'Jev relevance gate: Cloudflare WAF가 후보 본문을 차단했다 '
            + `(후보 ${docs.length}건, status 403, ${elapsedMs}ms). `
            + '코드펜스 뒤에 오는 curl -s·curl -sL·wget -q 가 트리거다. '
            + '후보 1건만 막혀도 배치 전체가 실패한다. 재시도하지 않는다(페이로드가 결정적).',
          );
          return nanScores(docs.length);
        }

        if (res.status === 401 || (res.status === 403 && isRecord(body) && 'detail' in body)) {
          const detail = isRecord(body) ? body.detail : undefined;
          const errorType = isRecord(detail) && 'error_type' in detail ? detail.error_type : undefined;
          logger.error(
            'Jev relevance gate: 인증 실패 '
            + `(후보 ${docs.length}건, status ${res.status}, ${elapsedMs}ms, error_type=${String(errorType)}). `
            + 'API 키를 확인하세요.',
          );
          return nanScores(docs.length);
        }

        logger.warn(
          `Jev relevance gate: 요청 실패 (후보 ${docs.length}건, status ${res.status}, ${elapsedMs}ms).`,
        );
        return nanScores(docs.length);
      }

      const data = (await readResponseJson(res)) as JevResponse | null;
      if (data === null) {
        logger.warn(
          `Jev relevance gate: 응답 파싱 실패 (후보 ${docs.length}건, status ${res.status}, ${elapsedMs}ms).`,
        );
        return nanScores(docs.length);
      }

      return candidateIds.map((candidateId) => {
        const noul = data.answers?.[candidateId]?.noul;
        return typeof noul === 'number' ? noul : Number.NaN;
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const label = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network error';
      logger.warn(
        `Jev relevance gate: ${label} (후보 ${docs.length}건, ${elapsedMs}ms). ${message}`,
      );
      return nanScores(docs.length);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
