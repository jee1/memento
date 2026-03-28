/**
 * 검색·랭킹 응답 확장 타입 (score_breakdown 등)
 */

export interface ScoreComponent {
  /** 가중치 적용 후 절대 기여값 */
  score: number;
  /** |total| 대비 백분율을 가장 가까운 정수로 반올림(0–100 근사); 부호는 기여 방향 유지 */
  pct: number;
}

export interface ScoreBreakdown {
  /**
   * “관련성 계열” 복합 슬롯: α·relevance(통합 점수 블렌딩 포함) + 관계 가중 + 절차 부스트 + 프로세스 적합도.
   * `pct`는 |total| 대비 비율(FR-008 / spec 004 contracts §1).
   */
  relevance: ScoreComponent;
  recency: ScoreComponent;
  importance: ScoreComponent;
  usage: ScoreComponent;
  feedback: ScoreComponent;
  duplication_penalty: ScoreComponent;
  total: number;
}
