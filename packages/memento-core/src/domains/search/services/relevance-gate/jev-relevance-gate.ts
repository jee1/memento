/**
 * TypeSafe Jev(System One) 기반 관련성 기각 게이트.
 * 검색 후보가 질의에 대한 유효한 맥락/답을 담고 있는지 P(true)를 배치 1회 호출로 판정한다.
 * #1095
 */

import type { IRelevanceGatePort } from '../../ports/relevance-gate-port.js';
import {
  SystemOneClient,
  type NoulQuestion,
  type SystemOneFailureReason,
  type SystemOneState,
} from '../../../../shared/services/typesafe/system-one-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { runWithLlmUsageLogicalContext } from '../../../../shared/services/llm-usage/llm-usage-logical-context.js';
import { recordSystemOneUsageAttempt } from '../../../../shared/services/llm-usage/llm-usage-systemone-attempt.js';

function nanScores(length: number): number[] {
  return Array.from({ length }, () => Number.NaN);
}

function neutralizeCodeFences(text: string): string {
  return text.replaceAll('```', '');
}

function buildNoulInstructions(candidateId: string, query: string): string {
  return `후보 ${candidateId} 가 질의 "${query}" 에 대한 유효한 맥락이나 답을 담고 있다`;
}

export class JevRelevanceGate implements IRelevanceGatePort {
  constructor(
    private readonly client: SystemOneClient,
    private readonly model: string,
    private readonly docChars: number = 300,
  ) {}

  /**
   * 절대 예외를 던지지 않는다. 실패는 Number.NaN 배열이다 (fail-open).
   */
  async score(query: string, docs: string[]): Promise<number[]> {
    if (docs.length === 0) {
      return [];
    }

    return runWithLlmUsageLogicalContext('relevance_gate', null, async () => {
      const candidateIds = docs.map((_, index) => `c${index}`);
      const questions: NoulQuestion[] = candidateIds.map((candidateId) => ({
        id: candidateId,
        instructions: buildNoulInstructions(candidateId, query),
      }));
      const state = this.buildState(query, docs, false);
      const retryState = docs.some((doc) => doc.includes('```'))
        ? this.buildState(query, docs, true)
        : undefined;

      const startedAt = Date.now();
      const result = await this.client.ask(state, questions, retryState);
      recordSystemOneUsageAttempt(this.model, result);
      const elapsedMs = Date.now() - startedAt;

      if (result.ok === true) {
        if (result.wafRetried) {
          this.logWaf(docs.length, elapsedMs, true);
        }
        return candidateIds.map((candidateId) => result.noulById.get(candidateId) ?? Number.NaN);
      }
      if (result.ok === false) {
        this.logFailure(result.reason, docs.length, elapsedMs, result.wafRetried);
      }
      return nanScores(docs.length);
    });
  }

  private buildState(query: string, docs: string[], neutralizeFences: boolean): SystemOneState {
    const state: Record<string, string> = { query };
    for (const [index, doc] of docs.entries()) {
      const text = neutralizeFences ? neutralizeCodeFences(doc) : doc;
      state[`c${index}`] = text.slice(0, this.docChars);
    }
    return state;
  }

  private logWaf(count: number, elapsedMs: number, neutralized: boolean): void {
    logger.warn(
      'Jev relevance gate: Cloudflare WAF가 후보 본문을 차단했다 '
      + `(후보 ${count}건, status 403, ${elapsedMs}ms, `
      + `펜스정규화=${neutralized ? '적용' : '미적용'}). `
      + '2026-09-23 에 관측한 트리거는 코드펜스 뒤의 curl -s·curl -sL·wget -q 였다. '
      + '2026-09-28 재실측에서는 같은 페이로드가 통과했으므로 룰이 또 바뀌었을 수 있다. '
      + '후보 1건만 막혀도 배치 전체가 실패한다.',
    );
  }

  private logFailure(
    reason: SystemOneFailureReason,
    count: number,
    elapsedMs: number,
    wafRetried: boolean,
  ): void {
    if (reason === 'waf') {
      this.logWaf(count, elapsedMs, wafRetried);
      return;
    }
    if (reason === 'auth') {
      logger.error(
        'Jev relevance gate: 인증 실패 '
        + `(후보 ${count}건, ${elapsedMs}ms). `
        + 'API 키를 확인하세요.',
      );
      return;
    }
    if (reason === 'parse') {
      logger.warn(
        `Jev relevance gate: 응답 파싱 실패 (후보 ${count}건, ${elapsedMs}ms).`,
      );
      return;
    }
    const label = reason === 'timeout' ? 'timeout' : reason === 'network' ? 'network error' : '요청 실패';
    logger.warn(`Jev relevance gate: ${label} (후보 ${count}건, ${elapsedMs}ms).`);
  }
}
