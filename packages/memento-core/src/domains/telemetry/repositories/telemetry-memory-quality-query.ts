import type Database from 'better-sqlite3';
import type { TelemetryPeriod } from '../types/telemetry.types.js';
import type {
  ConsolidationQualityResult,
  MemoryQualityResult
} from './telemetry-repository.js';
import { periodCutoffIso } from './telemetry-repository-utils.js';

export function queryMemoryQuality(
  db: Database.Database,
  period: TelemetryPeriod,
  ownerId?: string | null
): MemoryQualityResult {
  const now = new Date().toISOString();
  const cutoff = periodCutoffIso(period);
  const oClause =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const params: Record<string, unknown> = {};
  if (ownerId !== undefined && ownerId !== null) params.owner = ownerId;

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM memory_item WHERE 1=1 ${oClause}`)
    .get(params) as { c: number };

  const byType = db
    .prepare(
      `SELECT type, COUNT(*) AS c FROM memory_item WHERE 1=1 ${oClause} GROUP BY type`
    )
    .all(params) as { type: string; c: number }[];

  const dist: Record<string, number> = {};
  const t = total.c;
  for (const row of byType) {
    dist[row.type] = t > 0 ? row.c / t : 0;
  }

  const relOwner =
    ownerId === undefined || ownerId === null
      ? ''
      : ' AND m.owner_id = @owner ';
  const withRel = db
    .prepare(
      `SELECT COUNT(DISTINCT m.id) AS c
       FROM memory_item m
       WHERE EXISTS (
         SELECT 1 FROM memory_relation r
         WHERE r.source_id = m.id OR r.target_id = m.id
       ) ${relOwner}`
    )
    .get(params) as { c: number };

  const coverage = t > 0 ? withRel.c / t : null;
  const orphan = coverage != null ? 1 - coverage : null;

  const dupParams = { cutoff, ...params };
  const dupClause =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const completed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.write.completed' AND created_at >= @cutoff ${dupClause}`
    )
    .get(dupParams) as { c: number };
  const dupes = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.write.completed' AND created_at >= @cutoff
         AND json_extract(extra_data, '$.is_duplicate') = 1 ${dupClause}`
    )
    .get(dupParams) as { c: number };
  const dupRate = completed.c > 0 ? dupes.c / completed.c : null;

  return {
    owner_id: ownerId ?? null,
    total_memories: t > 0 ? t : 0,
    type_distribution: t > 0 ? dist : null,
    duplicate_write_rate_24h: dupRate,
    relation_coverage_ratio: coverage,
    orphan_memory_ratio: orphan,
    timestamp: now
  };
}

export function queryConsolidationQuality(
  db: Database.Database,
  period: TelemetryPeriod,
  ownerId?: string | null
): ConsolidationQualityResult {
  const now = new Date().toISOString();
  const cutoff = periodCutoffIso(period);
  const memOwner =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const telOwner =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const params: Record<string, unknown> = { cutoff };
  if (ownerId !== undefined && ownerId !== null) {
    params.owner = ownerId;
  }

  const ep = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'episodic' AND COALESCE(is_consolidated, 0) = 1 THEN 1 ELSE 0 END) AS cons,
         SUM(CASE WHEN type = 'episodic' THEN 1 ELSE 0 END) AS total
       FROM memory_item WHERE datetime(created_at) >= datetime(@cutoff) ${memOwner}`
    )
    .get(params) as { cons: number | null; total: number | null } | undefined;
  const totalEp = ep?.total ?? 0;
  const episodic_consolidation_rate =
    totalEp > 0 && ep?.cons != null ? ep.cons / totalEp : null;

  const tr = db
    .prepare(
      `SELECT
         SUM(CASE WHEN triple_extracted_status = 'success' THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN triple_extracted_status IN ('success', 'failed') THEN 1 ELSE 0 END) AS te
       FROM memory_item
       WHERE type = 'episodic'
         AND triple_extracted_status IN ('success', 'failed')
         AND datetime(
           CASE
             WHEN triple_extracted_status = 'success'
               THEN COALESCE(json_extract(triple_extraction_metadata, '$.extracted_at'), created_at)
             ELSE COALESCE(json_extract(triple_extraction_metadata, '$.last_attempt'), created_at)
           END
         ) >= datetime(@cutoff)
         ${memOwner}`
    )
    .get(params) as { ok: number | null; te: number | null } | undefined;
  const teCount = tr?.te ?? 0;
  const triple_extraction_success_rate =
    teCount > 0 && tr?.ok != null ? tr.ok / teCount : null;

  const perfRows = db
    .prepare(
      `SELECT extra_data FROM telemetry_events
       WHERE event_type = 'consolidation.performed'
         AND outcome = 'success'
         AND created_at >= @cutoff ${telOwner}`
    )
    .all(params) as { extra_data: string | null }[];
  let effSum = 0;
  let effN = 0;
  for (const r of perfRows) {
    if (!r.extra_data) {
      continue;
    }
    try {
      const j = JSON.parse(r.extra_data) as {
        clusters_processed?: number;
        clusters_found?: number;
      };
      const cf = j.clusters_found ?? 0;
      const cp = j.clusters_processed ?? 0;
      if (cf > 0) {
        effSum += cp / cf;
        effN++;
      }
    } catch {
      /* ignore */
    }
  }
  const cluster_processing_efficiency = effN > 0 ? effSum / effN : null;

  const semRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM memory_item
       WHERE type = 'semantic' AND datetime(created_at) >= datetime(@cutoff) ${memOwner}`
    )
    .get(params) as { c: number };
  const recent_semantic_count_7d = semRow?.c ?? 0;

  const errRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE outcome = 'failure'
         AND created_at >= @cutoff
         AND event_type IN ('consolidation.performed', 'telemetry.cleanup.performed') ${telOwner}`
    )
    .get(params) as { c: number };
  const tripleFailRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM memory_item
       WHERE type = 'episodic'
         AND triple_extracted_status = 'failed'
         AND COALESCE(is_deleted, 0) = 0
         AND (
           (
             triple_extraction_metadata IS NOT NULL
             AND json_extract(triple_extraction_metadata, '$.last_attempt') IS NOT NULL
             AND datetime(json_extract(triple_extraction_metadata, '$.last_attempt')) >= datetime(@cutoff)
           )
           OR (
             (
               triple_extraction_metadata IS NULL
               OR json_extract(triple_extraction_metadata, '$.last_attempt') IS NULL
             )
             AND datetime(created_at) >= datetime(@cutoff)
           )
         )
         ${memOwner}`
    )
    .get(params) as { c: number };
  const pipeline_error_count = (errRow?.c ?? 0) + (tripleFailRow?.c ?? 0);

  return {
    episodic_consolidation_rate,
    triple_extraction_success_rate,
    cluster_processing_efficiency,
    recent_semantic_count_7d,
    pipeline_error_count,
    timestamp: now
  };
}
