import type Database from 'better-sqlite3';
import type { TelemetryPeriod } from '../types/telemetry.types.js';
import type { FeedbackQualityResult } from './telemetry-repository.js';
import { periodCutoffIso } from './telemetry-repository-utils.js';

export function queryFeedbackQuality(
  db: Database.Database,
  period: TelemetryPeriod,
  ownerId?: string | null
): FeedbackQualityResult {
  const cutoff = periodCutoffIso(period);
  const hasOwner = ownerId !== undefined && ownerId !== null;
  const agentFilter = hasOwner ? ' AND agent_id = @agent ' : '';
  const ownerClause = hasOwner ? ' AND owner_id = @agent ' : '';
  const params: Record<string, unknown> = { cutoff };
  if (hasOwner) params.agent = ownerId;

  const positiveRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM feedback_event
       WHERE event = 'helpful' AND created_at >= @cutoff ${agentFilter}`
    )
    .get(params) as { c: number };

  const negativeRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM feedback_event
       WHERE event = 'not_helpful' AND created_at >= @cutoff ${agentFilter}`
    )
    .get(params) as { c: number };

  const ctxRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM feedback_event
       WHERE event IN ('helpful', 'not_helpful')
         AND created_at >= @cutoff
         AND score_breakdown_json IS NOT NULL
         AND score_breakdown_json != ''
         ${agentFilter}`
    )
    .get(params) as { c: number };

  // 채택 갭 관측 (Issue #729): feedback_event에 request_id가 없어 recall 1건↔feedback 1건을
  // 정확히 매칭할 수는 없다 — memory.search.requested(memory_injection 포함) 총량 대비
  // helpful/not_helpful 총량의 대략 비율로 "미피드백 recall 비율"을 근사한다.
  const recallRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.search.requested' AND created_at >= @cutoff ${ownerClause}`
    )
    .get(params) as { c: number };

  const positive_count = positiveRow.c;
  const negative_count = negativeRow.c;
  const total = positive_count + negative_count;
  const helpful_rate = total > 0 ? positive_count / total : null;
  const recall_count = recallRow.c;
  // total(helpful+not_helpful)이 recall_count를 넘을 수 있어(매칭 미보장) 0으로만 clamp —
  // total>=0이므로 1 - total/recall_count는 1을 초과할 수 없다.
  const recall_without_feedback_rate =
    recall_count > 0 ? Math.max(0, 1 - total / recall_count) : null;

  return {
    period,
    owner_id: ownerId ?? null,
    helpful_rate,
    positive_count,
    negative_count,
    feedback_with_ranking_context_count: ctxRow.c,
    recall_count,
    recall_without_feedback_rate,
    timestamp: new Date().toISOString()
  };
}
