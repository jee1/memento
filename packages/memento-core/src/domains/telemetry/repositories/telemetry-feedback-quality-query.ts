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
  const agentFilter =
    ownerId === undefined || ownerId === null ? '' : ' AND agent_id = @agent ';
  const params: Record<string, unknown> = { cutoff };
  if (ownerId !== undefined && ownerId !== null) params.agent = ownerId;

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

  const positive_count = positiveRow.c;
  const negative_count = negativeRow.c;
  const total = positive_count + negative_count;
  const helpful_rate = total > 0 ? positive_count / total : null;

  return {
    period,
    owner_id: ownerId ?? null,
    helpful_rate,
    positive_count,
    negative_count,
    feedback_with_ranking_context_count: ctxRow.c,
    timestamp: new Date().toISOString()
  };
}
