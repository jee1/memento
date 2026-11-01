/**
 * Memory Item Repository (#1094)
 * 기억 항목 기본 CRUD 및 보존 기간 만료/완전 삭제 쿼리
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { embeddingColumnToNumbers } from '../../../shared/utils/embedding-serialization.js';

export interface MemoryItemEntity {
  id: string;
  content: string;
  type: string;
  importance: number;
  pinned: boolean | number;
  is_deleted: boolean | number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  owner_id?: string | null;
  project_id?: string | null;
}

export interface ActiveMemoryIdAndContentRow {
  id: string;
  content: string;
}

export interface AnchorMemorySummaryRow {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
}

export interface MemoryEmbeddingMapCandidateRow {
  id: string;
  content: string;
  type: string;
  importance: number | null;
  created_at: string | null;
  tags: string | null;
  embedding: Buffer;
  dim: number;
  dimensions: number | null;
  model: string | null;
}

export interface MemoryGraphNodeQueryFilter {
  types?: string[] | null;
  relation_types?: string[] | null;
  min_importance?: number;
  exclude_orphans?: boolean;
  limit: number;
}

export interface MemoryGraphNodeRow {
  id: string;
  content: string;
  type: string;
  importance: number | null;
  created_at: string | null;
  tags: string | null;
  pinned: number | null;
}

export interface MemoryGraphNodeQueryResult {
  totalAvailableNodes: number;
  rawNodes: MemoryGraphNodeRow[];
}

export interface ProjectMemoryStats {
  total: number;
  by_type: Record<string, number>;
  oldest: string | null;
  newest: string | null;
}

export interface ProjectMemoryCleanupCandidateRow {
  id: string;
  content: string;
  type: string;
  created_at: string;
}

export interface MemoryForgettingStatsByTypeRow {
  type: string;
  total_count: number;
  pinned_count: number;
  old_count: number;
}

export interface MemoryCountsByTypeStatsRow {
  total_memories: number;
  working_memories: number;
  episodic_memories: number;
  semantic_memories: number;
  procedural_memories: number;
  pinned_memories: number;
}

export interface MemoryProvenancePreviewRow {
  id: string;
  type: string;
  content_preview: string;
  created_at: string | null;
}

export interface MemoryResourceRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  tags: string | null;
  source: string | null;
  created_at: string;
  last_accessed: string | null;
  pinned: number | boolean;
}

export interface SupersedeScopeMemoryRow {
  id: string;
  content: string;
  type: string;
  ownerId: string | null;
  projectId: string | null;
  privacyScope: string;
  createdAt: string;
  /** julianday(created_at). created_at 은 ISO 와 공백 형식이 섞여 있어 문자열 비교를 쓰지 않는다. */
  createdJd: number;
  /** created_at 이 호출 시점 기준 lookback 안에 있다. */
  isRecent: boolean;
  embedding: number[];
  embeddingModel: string | null;
}

export interface SupersedeScopeMemories {
  memories: SupersedeScopeMemoryRow[];
  withoutEmbedding: number;
}

export function listActiveMemoryIdAndContent(
  db: Database.Database,
): ActiveMemoryIdAndContentRow[] {
  return db
    .prepare('SELECT id, content FROM memory_item WHERE COALESCE(is_deleted, 0) = 0')
    .all() as ActiveMemoryIdAndContentRow[];
}

/**
 * #1551: 승인된 직접 대체는 포인터가 가리키는 target 이 살아 있을 때만 유효하다.
 * target 이 지워지면 옛 기억은 쓰기 없이 다시 현재가 된다. memory_relation, memory_link 는 보지 않는다.
 * 보간 없는 고정 SQL 이라 memory_item 별칭이 mi 인 질의에서만 쓴다.
 */
const SUPERSEDED_BY_ACTIVE_TARGET_SQL = `EXISTS (SELECT 1 FROM memory_item supersede_target
    WHERE supersede_target.id = mi.superseded_by AND COALESCE(supersede_target.is_deleted, 0) = 0)`;

/** 주어진 id 중 지금 대체된 기억. */
export function findSupersededMemoryIds(db: Database.Database, ids: readonly string[]): Set<string> {
  if (ids.length === 0) {
    return new Set();
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT mi.id AS id FROM memory_item mi
       WHERE mi.id IN (${placeholders})
         AND ${SUPERSEDED_BY_ACTIVE_TARGET_SQL}`,
    )
    .all(...ids) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

export interface SupersedeApplyMemoryRow {
  id: string;
  content: string;
  type: string;
  ownerId: string | null;
  projectId: string | null;
  privacyScope: string;
  isDeleted: boolean;
  supersededBy: string | null;
}

export function findSupersedeApplyMemory(
  db: Database.Database,
  id: string,
): SupersedeApplyMemoryRow | undefined {
  const row = db
    .prepare(
      `SELECT id, content, type, owner_id AS ownerId, project_id AS projectId,
              COALESCE(privacy_scope, 'private') AS privacyScope,
              COALESCE(is_deleted, 0) AS isDeleted, superseded_by AS supersededBy
       FROM memory_item WHERE id = ?`,
    )
    .get(id) as (Omit<SupersedeApplyMemoryRow, 'isDeleted'> & { isDeleted: number }) | undefined;
  return row && { ...row, isDeleted: row.isDeleted !== 0 };
}

/** CAS: 포인터가 비었고 삭제되지 않은 행만 바꾼다. */
export function compareAndSetSupersededBy(db: Database.Database, oldId: string, newId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE memory_item SET superseded_by = ?
         WHERE id = ? AND superseded_by IS NULL AND COALESCE(is_deleted, 0) = 0`,
      )
      .run(newId, oldId).changes === 1
  );
}

/** CAS: 포인터가 기대한 target 일 때만 지운다. */
export function compareAndClearSupersededBy(
  db: Database.Database,
  oldId: string,
  expectedNewId: string,
): boolean {
  return (
    db
      .prepare('UPDATE memory_item SET superseded_by = NULL WHERE id = ? AND superseded_by = ?')
      .run(oldId, expectedNewId).changes === 1
  );
}

export interface ProcedureSubjectRow {
  id: string;
  type: string;
  content: string;
  steps: string | null;
  ownerId: string | null;
  projectId: string | null;
  originSource: string | null;
}

const PROCEDURE_SUBJECT_COLUMNS = `id, type, content, steps, owner_id AS ownerId, project_id AS projectId,
  origin_source AS originSource`;

/** #1550: 실행 증거를 붙이거나 채택 게이트가 읽는 활성 기억 한 건. */
export function findActiveProcedureSubject(db: Database.Database, id: string): ProcedureSubjectRow | undefined {
  return db
    .prepare(`SELECT ${PROCEDURE_SUBJECT_COLUMNS} FROM memory_item WHERE id = ? AND COALESCE(is_deleted, 0) = 0`)
    .get(id) as ProcedureSubjectRow | undefined;
}

/** #1550: 시리즈가 지금 제공하는 버전. 지워진 최신 버전은 건너뛴다. 시리즈 id 가 없는 v1 은 자기 id 가 시리즈다. */
export function findServedProceduralVersion(
  db: Database.Database,
  versionSeriesId: string,
): ProcedureSubjectRow | undefined {
  return db
    .prepare(
      `SELECT ${PROCEDURE_SUBJECT_COLUMNS} FROM memory_item
       WHERE type = 'procedural' AND COALESCE(is_deleted, 0) = 0
         AND (version_series_id = ? OR (version_series_id IS NULL AND id = ?))
       ORDER BY COALESCE(version, 1) DESC LIMIT 1`,
    )
    .get(versionSeriesId, versionSeriesId) as ProcedureSubjectRow | undefined;
}

/**
 * 대체 후보 탐색 대상: 삭제되지 않은 semantic/episodic 과 native 임베딩 하나(가장 최근 행).
 * 이미 대체된 기억은 뺀다. 벡터가 없는 기억은 쌍을 만들 수 없어 개수만 센다.
 */
export function findSupersedeScopeMemories(
  db: Database.Database,
  lookbackDays: number,
): SupersedeScopeMemories {
  const rows = db
    .prepare(
      `SELECT
         mi.id AS id,
         mi.content AS content,
         mi.type AS type,
         mi.owner_id AS ownerId,
         mi.project_id AS projectId,
         COALESCE(mi.privacy_scope, 'private') AS privacyScope,
         mi.created_at AS createdAt,
         julianday(mi.created_at) AS createdJd,
         julianday(mi.created_at) >= julianday('now') - ? AS isRecent,
         me.embedding AS embedding,
         me.model AS embeddingModel
       FROM memory_item mi
       LEFT JOIN memory_embedding me
         ON me.memory_id = mi.id
        AND me.projection_type = 'native'
        AND me.id = (
          SELECT MAX(latest.id) FROM memory_embedding latest
          WHERE latest.memory_id = mi.id AND latest.projection_type = 'native'
        )
       WHERE mi.type IN ('semantic', 'episodic')
         AND COALESCE(mi.is_deleted, 0) = 0
         AND NOT ${SUPERSEDED_BY_ACTIVE_TARGET_SQL}
         AND julianday(mi.created_at) IS NOT NULL`,
    )
    .all(lookbackDays) as Array<
    Omit<SupersedeScopeMemoryRow, 'embedding' | 'isRecent'> & { embedding: Buffer | null; isRecent: number }
  >;

  const memories: SupersedeScopeMemoryRow[] = [];
  let withoutEmbedding = 0;
  for (const row of rows) {
    const embedding = embeddingColumnToNumbers(row.embedding);
    if (!embedding) {
      withoutEmbedding += 1;
      continue;
    }
    memories.push({ ...row, embedding, isRecent: row.isRecent === 1 });
  }
  return { memories, withoutEmbedding };
}

export function findAnchorMemorySummaryById(
  db: Database.Database,
  id: string,
): AnchorMemorySummaryRow | undefined {
  return db
    .prepare(
      `SELECT id, content, type, importance, created_at
       FROM memory_item
       WHERE id = ?`,
    )
    .get(id) as AnchorMemorySummaryRow | undefined;
}

export function countActiveMemoryItems(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memory_item
       WHERE COALESCE(is_deleted, 0) = 0`,
    )
    .get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export function listMemoryEmbeddingMapCandidates(
  db: Database.Database,
  provider: string,
  limit: number,
): MemoryEmbeddingMapCandidateRow[] {
  return db
    .prepare(
      `SELECT
         mi.id,
         mi.content,
         mi.type,
         mi.importance,
         mi.created_at,
         mi.tags,
         me.embedding,
         me.dim,
         me.dimensions,
         me.model
       FROM memory_item mi
       INNER JOIN memory_embedding me
         ON me.memory_id = mi.id
        AND me.embedding_provider = ?
        AND me.projection_type = 'native'
       WHERE COALESCE(mi.is_deleted, 0) = 0
       ORDER BY COALESCE(mi.importance, 0.5) DESC, datetime(mi.created_at) DESC
       LIMIT ?`,
    )
    .all(provider, limit) as MemoryEmbeddingMapCandidateRow[];
}

export function queryMemoryGraphNodes(
  db: Database.Database,
  filter: MemoryGraphNodeQueryFilter,
): MemoryGraphNodeQueryResult {
  const minImportance = filter.min_importance ?? 0.0;
  let nodeQuery = `SELECT id, content, type, importance, created_at, tags, pinned FROM memory_item WHERE 1=1 AND COALESCE(is_deleted, 0) = 0`;
  let countQuery = `SELECT COUNT(*) AS count FROM memory_item WHERE 1=1 AND COALESCE(is_deleted, 0) = 0`;
  const nodeParams: (string | number)[] = [];
  const countParams: (string | number)[] = [];

  if (filter.types && filter.types.length > 0) {
    const placeholders = filter.types.map(() => '?').join(', ');
    nodeQuery += ` AND type IN (${placeholders})`;
    countQuery += ` AND type IN (${placeholders})`;
    nodeParams.push(...filter.types);
    countParams.push(...filter.types);
  }

  nodeQuery += ` AND COALESCE(importance, 0.5) >= ?`;
  countQuery += ` AND COALESCE(importance, 0.5) >= ?`;
  nodeParams.push(minImportance);
  countParams.push(minImportance);

  const excludeOrphans = filter.exclude_orphans === true;
  if (excludeOrphans) {
    const orphanRelationTypes = filter.relation_types ?? [];
    const typeClause =
      orphanRelationTypes.length > 0
        ? ` AND mr.relation_type IN (${orphanRelationTypes.map(() => '?').join(', ')})`
        : '';
    const existsClause =
      ` AND EXISTS (SELECT 1 FROM memory_relation mr` +
      ` JOIN memory_item related ON related.id = CASE` +
      ` WHEN mr.source_id = memory_item.id THEN mr.target_id ELSE mr.source_id END` +
      ` WHERE (mr.source_id = memory_item.id OR mr.target_id = memory_item.id)` +
      ` AND COALESCE(related.is_deleted, 0) = 0${typeClause})`;
    nodeQuery += existsClause;
    countQuery += existsClause;
    nodeParams.push(...orphanRelationTypes);
    countParams.push(...orphanRelationTypes);
  }

  nodeQuery += ` ORDER BY COALESCE(importance, 0.5) DESC LIMIT ?`;
  nodeParams.push(filter.limit + 1);

  const countRow = db.prepare(countQuery).get(...countParams) as { count: number } | undefined;
  const totalAvailableNodes = countRow?.count ?? 0;
  const rawNodes = db.prepare(nodeQuery).all(...nodeParams) as MemoryGraphNodeRow[];

  return { totalAvailableNodes, rawNodes };
}

export function queryProjectMemoryStats(
  db: Database.Database,
  projectId: string,
): ProjectMemoryStats {
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM memory_item
       WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`,
    )
    .get(projectId) as { total: number };

  const byTypeRows = db
    .prepare(
      `SELECT type, COUNT(*) as count
       FROM memory_item
       WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0
       GROUP BY type`,
    )
    .all(projectId) as Array<{ type: string; count: number }>;

  const dateRangeRow = db
    .prepare(
      `SELECT MIN(created_at) as oldest, MAX(created_at) as newest
       FROM memory_item
       WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`,
    )
    .get(projectId) as { oldest: string | null; newest: string | null };

  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.type] = row.count;
  }

  return {
    total: totalRow.total,
    by_type: byType,
    oldest: dateRangeRow.oldest,
    newest: dateRangeRow.newest,
  };
}

export function listProjectMemoryCleanupCandidates(
  db: Database.Database,
  projectId: string,
  types: string[],
  olderThanDays: number,
): ProjectMemoryCleanupCandidateRow[] {
  const placeholders = types.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, content, type, created_at
       FROM memory_item
       WHERE project_id = ? AND type IN (${placeholders})
         AND created_at < datetime('now', '-${olderThanDays} days')
         AND COALESCE(is_deleted, 0) = 0`,
    )
    .all(projectId, ...types) as ProjectMemoryCleanupCandidateRow[];
}

export function deleteProjectMemoriesOlderThan(
  db: Database.Database,
  projectId: string,
  types: string[],
  olderThanDays: number,
): number {
  const placeholders = types.map(() => '?').join(', ');
  const result = db
    .prepare(
      `DELETE FROM memory_item
       WHERE project_id = ? AND type IN (${placeholders})
         AND created_at < datetime('now', '-${olderThanDays} days')
         AND COALESCE(is_deleted, 0) = 0`,
    )
    .run(projectId, ...types);
  return result.changes;
}

export function deleteExpiredWorkingMemories(db: Database.Database): number {
  const result = db
    .prepare(
      `DELETE FROM memory_item
       WHERE pinned = FALSE AND type = 'working' AND created_at < datetime('now', '-2 days')`,
    )
    .run();
  return result.changes;
}

export function queryMemoryForgettingStatsByType(
  db: Database.Database,
): MemoryForgettingStatsByTypeRow[] {
  return db
    .prepare(
      `SELECT
         type,
         COUNT(*) as total_count,
         COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
         COUNT(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 END) as old_count
       FROM memory_item
       GROUP BY type`,
    )
    .all() as MemoryForgettingStatsByTypeRow[];
}

export function queryMemoryCountsByTypeStats(
  db: Database.Database,
): MemoryCountsByTypeStatsRow | undefined {
  return db
    .prepare(
      `SELECT
         COUNT(*) as total_memories,
         COUNT(CASE WHEN type = 'working' THEN 1 END) as working_memories,
         COUNT(CASE WHEN type = 'episodic' THEN 1 END) as episodic_memories,
         COUNT(CASE WHEN type = 'semantic' THEN 1 END) as semantic_memories,
         COUNT(CASE WHEN type = 'procedural' THEN 1 END) as procedural_memories,
         COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_memories
       FROM memory_item`,
    )
    .get() as MemoryCountsByTypeStatsRow | undefined;
}

/** 입력 순서를 지키고 중복 id 는 한 번만 담는다. */
export function findMemoryProvenancePreviews(
  db: Database.Database,
  memoryIds: readonly string[],
): MemoryProvenancePreviewRow[] {
  const uniqueIds = [...new Set(memoryIds)];
  if (uniqueIds.length === 0) {
    return [];
  }

  const stmt = db.prepare(
    `SELECT id, type, substr(content, 1, 240) AS content_preview, created_at
     FROM memory_item
     WHERE id = ?`,
  );
  return uniqueIds.flatMap((id) => {
    const row = stmt.get(id) as MemoryProvenancePreviewRow | undefined;
    return row ? [row] : [];
  });
}

export function listRecentMemoryResourceIds(
  db: Database.Database,
): Array<{ id: string }> {
  return DatabaseUtils.all(
    db,
    'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000',
  ) as Array<{ id: string }>;
}

export function findMemoryResourceRowById(
  db: Database.Database,
  id: string,
): MemoryResourceRow | undefined {
  return DatabaseUtils.get(
    db,
    `SELECT
       id, type, content, importance, privacy_scope,
       tags, source, created_at, last_accessed, pinned
     FROM memory_item
     WHERE id = ?`,
    [id],
  ) as MemoryResourceRow | undefined;
}


export class MemoryItemRepository {
  findById(db: Database.Database, id: string): MemoryItemEntity | null {
    const row = db
      .prepare('SELECT * FROM memory_item WHERE id = ?')
      .get(id) as MemoryItemEntity | undefined;
    return row ?? null;
  }

  findExpiredSoftDeleted(db: Database.Database, retentionDays: number): string[] {
    if (retentionDays <= 0) {
      const rows = db
        .prepare('SELECT id FROM memory_item WHERE is_deleted = 1')
        .all() as Array<{ id: string }>;
      return rows.map((r) => r.id);
    }

    const rows = db
      .prepare(
        `SELECT id FROM memory_item 
          WHERE is_deleted = 1 
            AND deleted_at IS NOT NULL 
            AND julianday('now') - julianday(deleted_at) >= ?`,
      )
      .all(retentionDays) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  countActive(db: Database.Database): number {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM memory_item WHERE is_deleted = 0')
      .get() as { count: number };
    return row.count;
  }

  countSoftDeleted(db: Database.Database): number {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM memory_item WHERE is_deleted = 1')
      .get() as { count: number };
    return row.count;
  }
}
