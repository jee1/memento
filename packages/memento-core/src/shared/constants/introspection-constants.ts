/**
 * 메타-기억 인트로스펙션 관련 상수 (Issue #21 Phase B)
 * recall / get_meta_memory_stats 응답의 introspection_hint.summary에 붙이는 접미사.
 */

/** introspection_hint.summary 뒤에 붙이는 권장 문구 (get_introspection_summary 호출 유도) */
export const INTROSPECTION_HINT_SUFFIX =
  ' 자세한 내용은 get_introspection_summary 호출 권장.';

export interface IntrospectionHint {
  summary: string;
  low_confidence_count: number;
  high_failure_count: number;
  scanned_at: string;
}

/**
 * 캐시된 인트로스펙션 스캔을 recall·get_meta_memory_stats 응답용 힌트로 변환한다.
 *
 * 건수는 ID 목록 길이가 아니라 총계를 쓴다 — 목록은 limit(기본 1000)에 잘리므로
 * 길이를 세면 천장이 관측값으로 보고된다 (#997).
 * 두 소비자가 같은 블록을 손으로 복사하던 것을 한 곳으로 모은 것이다.
 * 플래그할 것이 없으면 undefined 를 돌려주고, 호출부는 그때 힌트를 붙이지 않는다.
 */
export function buildIntrospectionHint(
  cached: {
    result: {
      summary: string;
      lowConfidenceTotal: number;
      highFailureTotal: number;
    };
    scanned_at: string;
  } | null | undefined,
): IntrospectionHint | undefined {
  if (!cached) {
    return undefined;
  }
  if (cached.result.lowConfidenceTotal === 0 && cached.result.highFailureTotal === 0) {
    return undefined;
  }
  return {
    summary: `${cached.result.summary}${INTROSPECTION_HINT_SUFFIX}`,
    low_confidence_count: cached.result.lowConfidenceTotal,
    high_failure_count: cached.result.highFailureTotal,
    scanned_at: cached.scanned_at,
  };
}
