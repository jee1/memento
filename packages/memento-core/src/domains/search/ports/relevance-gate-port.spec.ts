import { describe, expect, it } from 'vitest';
import { judgeRelevanceGate, DEFAULT_RELEVANCE_GATE_THRESHOLD } from './relevance-gate-port.js';

describe('judgeRelevanceGate', () => {
  it('무관 질의 기각', () => {
    const verdict = judgeRelevanceGate([0.01, 0.05, 0.03, 0.02], 0.5);
    expect(verdict.rejected).toBe(true);
    expect(verdict.topScore).toBe(0.05);
    expect(verdict.unscored).toBe(0);
  });

  it('관련 질의 통과', () => {
    const verdict = judgeRelevanceGate([0.90, 0.88, 0.47, 0.11], 0.5);
    expect(verdict.rejected).toBe(false);
    expect(verdict.topScore).toBe(0.9);
  });

  it('경계값: topScore 가 threshold 와 정확히 같으면 통과한다', () => {
    const verdict = judgeRelevanceGate([0.5], 0.5);
    expect(verdict.rejected).toBe(false);
  });

  it('경계값: threshold 바로 아래는 기각', () => {
    const verdict = judgeRelevanceGate([0.49], 0.5);
    expect(verdict.rejected).toBe(true);
  });

  it('빈 배열은 fail-open', () => {
    expect(judgeRelevanceGate([], 0.5)).toEqual({
      rejected: false,
      topScore: null,
      threshold: 0.5,
      unscored: 0,
    });
  });

  it('전부 NaN 이면 fail-open', () => {
    // 게이트 장애(WAF 차단·타임아웃)가 검색 실패로 번지면 안 된다.
    const verdict = judgeRelevanceGate([NaN, NaN, NaN], 0.5);
    expect(verdict.rejected).toBe(false);
    expect(verdict.topScore).toBe(null);
    expect(verdict.unscored).toBe(3);
  });

  it('일부만 NaN 이면 남은 점수로 판정한다', () => {
    const verdict = judgeRelevanceGate([NaN, 0.8, NaN], 0.5);
    expect(verdict.rejected).toBe(false);
    expect(verdict.topScore).toBe(0.8);
    expect(verdict.unscored).toBe(2);
  });

  it('Infinity 는 유효 점수가 아니다', () => {
    const verdict = judgeRelevanceGate([Infinity, -Infinity, 0.2], 0.5);
    expect(verdict.topScore).toBe(0.2);
    expect(verdict.unscored).toBe(2);
    expect(verdict.rejected).toBe(true);
  });

  it('threshold 값이 반환 객체에 그대로 실린다', () => {
    expect(judgeRelevanceGate([0.3], 0.42).threshold).toBe(0.42);
  });

  it('기본 임계값은 2026-09-23 운영 DB 실측 기준 0.5 다', () => {
    expect(DEFAULT_RELEVANCE_GATE_THRESHOLD).toBe(0.5);
  });

  it('점수를 하나도 못 얻으면 기본값(open)은 기각하지 않는다', () => {
    const verdict = judgeRelevanceGate([NaN, NaN, NaN], 0.5);

    expect(verdict.rejected).toBe(false);
    expect(verdict.topScore).toBeNull();
    expect(verdict.unscored).toBe(3);
  });

  it("onError='closed' 면 점수를 하나도 못 얻었을 때 기각한다", () => {
    const verdict = judgeRelevanceGate([NaN, NaN, NaN], 0.5, 'closed');

    expect(verdict.rejected).toBe(true);
    expect(verdict.topScore).toBeNull();
    expect(verdict.unscored).toBe(3);
  });

  it("onError='closed' 여도 유효 점수가 있으면 임계값으로만 판정한다", () => {
    expect(judgeRelevanceGate([NaN, 0.8, NaN], 0.5, 'closed').rejected).toBe(false);
    expect(judgeRelevanceGate([NaN, 0.2, NaN], 0.5, 'closed').rejected).toBe(true);
  });

  it("후보 0건도 onError='closed' 에서는 기각으로 판정된다", () => {
    // 호출부(hybrid-search-engine)가 finalResults.length > 0 일 때만 게이트를 부르므로
    // 실제 경로에서는 도달하지 않는다. 순수 함수의 계약만 고정한다.
    expect(judgeRelevanceGate([], 0.5, 'closed').rejected).toBe(true);
  });
});
