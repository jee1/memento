/**
 * 피드백 이벤트 타입 (feedback_event 테이블)
 */

export type FeedbackEventType = 'used' | 'edited' | 'neglected' | 'helpful' | 'not_helpful';

export interface FeedbackEvent {
  id: number;
  memory_id: string;
  event: FeedbackEventType;
  score?: number;
  /** Optional comment (HTTP client / tools) */
  comment?: string;
  session_id?: string;
  agent_id?: string;
  /** recall score_breakdown JSON 스냅샷(US3) */
  score_breakdown_json?: string | null;
  created_at: string;
}

export interface CreateFeedbackEventInput {
  memory_id: string;
  event: FeedbackEventType;
  score?: number;
  comment?: string;
  session_id?: string;
  agent_id?: string;
  /** recall 항목의 score_breakdown 스냅샷(JSON 문자열; US3 not_helpful 맥락) */
  score_breakdown_json?: string | null;
}

export interface FeedbackNetScore {
  memory_id: string;
  /** helpful − not_helpful 건수 (슬라이딩 윈도우 내 원시 정수) */
  net_score: number;
}
