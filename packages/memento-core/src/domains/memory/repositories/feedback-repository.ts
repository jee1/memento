/**
 * 피드백 이벤트 저장 및 net score 집계 (90일 슬라이딩 윈도우)
 */

import type Database from 'better-sqlite3';
import type { CreateFeedbackEventInput, FeedbackNetScore } from '../../../shared/types/feedback.types.js';

/**
 * SQLite `SQLITE_MAX_VARIABLE_NUMBER`는 빌드마다 다르지만 흔히 999.
 * `IN (...)` 플레이스홀더 + 날짜 바인드 1개를 남기고 여유를 둔다.
 */
const GET_NET_SCORES_MAX_IDS_PER_QUERY = 500;

/** net_score(정수)를 [0,1]로 시그모이드 정규화 */
export function sigmoidNormalizedNet(net: number): number {
  return 1 / (1 + Math.exp(-net));
}

export class FeedbackRepository {
  constructor(private readonly db: Database.Database) {}

  insertFeedback(input: CreateFeedbackEventInput): { id: number; created_at: string } {
    const row = this.db
      .prepare(
        `INSERT INTO feedback_event (memory_id, event, score, comment, session_id, agent_id, score_breakdown_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id, created_at`
      )
      .get(
        input.memory_id,
        input.event,
        input.score ?? null,
        input.comment ?? null,
        input.session_id ?? null,
        input.agent_id ?? null,
        input.score_breakdown_json ?? null
      ) as { id: number; created_at: string };
    return { id: Number(row.id), created_at: String(row.created_at) };
  }

  /**
   * 메모리 ID별 helpful − not_helpful 순합 (90일 윈도우). 미존재 ID는 맵에 포함하지 않음.
   */
  getNetScores(memoryIds: string[], windowDays: number = 90): Map<string, number> {
    const out = new Map<string, number>();
    if (memoryIds.length === 0) {
      return out;
    }
    const uniqueIds = [...new Set(memoryIds)];
    const modifier = `-${windowDays} days`;
    const sqlTemplate = `
      SELECT memory_id,
        COALESCE(SUM(CASE
          WHEN event = 'helpful' THEN 1
          WHEN event = 'not_helpful' THEN -1
          ELSE 0
        END), 0) AS net_score
      FROM feedback_event
      WHERE memory_id IN (#PLACEHOLDERS#)
        AND created_at >= datetime('now', ?)
      GROUP BY memory_id
    `;

    for (let i = 0; i < uniqueIds.length; i += GET_NET_SCORES_MAX_IDS_PER_QUERY) {
      const chunk = uniqueIds.slice(i, i + GET_NET_SCORES_MAX_IDS_PER_QUERY);
      const placeholders = chunk.map(() => '?').join(',');
      const sql = sqlTemplate.replace('#PLACEHOLDERS#', placeholders);
      const rows = this.db.prepare(sql).all(...chunk, modifier) as Array<{
        memory_id: string;
        net_score: number;
      }>;
      for (const row of rows) {
        out.set(row.memory_id, Number(row.net_score));
      }
    }
    return out;
  }

  /** 테스트·진단용: ID 목록에 대한 FeedbackNetScore 배열 */
  getNetScoreRows(memoryIds: string[], windowDays: number = 90): FeedbackNetScore[] {
    const m = this.getNetScores(memoryIds, windowDays);
    return memoryIds
      .filter(id => m.has(id))
      .map(id => ({ memory_id: id, net_score: m.get(id)! }));
  }
}
