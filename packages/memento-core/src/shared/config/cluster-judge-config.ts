/**
 * Sleep consolidation 판정기 설정. 판정기와 설정 레지스트리(#1582)가 같은 규칙으로 읽는다.
 */

/** CONSOLIDATION_JUDGE=typesafe 만 판정기를 켠다. 다른 값은 cosine 군집만 쓴다. */
export function isClusterJudgeEnabled(): boolean {
  return process.env.CONSOLIDATION_JUDGE === 'typesafe';
}

/** 40 labeled production pairs (2026-10-03): 0.6 kept 14/15 same-topic and 0/25 different-topic pairs. */
export function getClusterJudgeThreshold(): number {
  const raw = process.env.CONSOLIDATION_JUDGE_THRESHOLD;
  const n = raw ? parseFloat(raw) : 0.6;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.6;
}
