/**
 * Sleep consolidation — DB 접근
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';

export interface EpisodicCandidateRow {
  id: string;
  content: string;
  importance: number;
  ownerId: string | null;
  createdAt: string;
  pinned: boolean;
  isConsolidated: boolean;
}

export interface SemanticOwnerRow {
  id: string;
  content: string;
  originSource: string;
  ownerId: string | null;
}

export class ConsolidationRepository {
  constructor(private readonly db: Database.Database) {}

  getLookbackDays(): number {
    const raw = process.env.CONSOLIDATION_LOOKBACK_DAYS;
    const n = raw ? parseInt(raw, 10) : 90;
    return Number.isFinite(n) && n > 0 ? n : 90;
  }

  /**
   * 클러스터링 대상 에피소딕 (미통합, 비핀, lookback 이내)
   */
  findEpisodicCandidates(
    ownerIdFilter: string | null | undefined,
    lookbackDays?: number
  ): EpisodicCandidateRow[] {
    const days = lookbackDays ?? this.getLookbackDays();
    const rows = DatabaseUtils.all(
      this.db,
      `
      SELECT
        id,
        content,
        importance,
        owner_id AS ownerId,
        created_at AS createdAt,
        pinned AS pinned,
        COALESCE(is_consolidated, 0) AS isConsolidated
      FROM memory_item
      WHERE type = 'episodic'
        AND COALESCE(is_consolidated, 0) = 0
        AND COALESCE(pinned, 0) = 0
        AND (is_deleted IS NULL OR is_deleted = 0)
        AND datetime(created_at) >= datetime('now', '-' || ? || ' days')
        AND (? IS NULL OR owner_id = ?)
      ORDER BY created_at DESC
    `,
      [days, ownerIdFilter ?? null, ownerIdFilter ?? null]
    ) as Array<{
      id: string;
      content: string;
      importance: number;
      ownerId: string | null;
      createdAt: string;
      pinned: number | boolean;
      isConsolidated: number | boolean;
    }>;

    return rows.map(r => ({
      id: r.id,
      content: r.content,
      importance: r.importance,
      ownerId: r.ownerId,
      createdAt: r.createdAt,
      pinned: Boolean(r.pinned),
      isConsolidated: Boolean(r.isConsolidated)
    }    ));
  }

  /**
   * owner별 시맨틱 후보 (재요약 병합용)
   */
  findSemanticsByOwner(ownerId: string | null): SemanticOwnerRow[] {
    const rows = DatabaseUtils.all(
      this.db,
      `
      SELECT id, content, COALESCE(origin_source, '{}') AS originSource, owner_id AS ownerId
      FROM memory_item
      WHERE type = 'semantic'
        AND (is_deleted IS NULL OR is_deleted = 0)
        AND COALESCE(owner_id, '') = COALESCE(?, '')
      ORDER BY created_at ASC
    `,
      [ownerId ?? null]
    ) as SemanticOwnerRow[];
    return rows;
  }

  updateSemanticMemory(params: { id: string; content: string; originSourceJson: string }): void {
    DatabaseUtils.run(
      this.db,
      `
      UPDATE memory_item
      SET content = ?, origin_source = ?
      WHERE id = ? AND type = 'semantic'
    `,
      [params.content, params.originSourceJson, params.id]
    );
  }

  /**
   * memory_id → 파싱된 임베딩 벡터 (첫 행만, 임의 provider 우선 최신)
   */
  loadEmbeddingsMap(memoryIds: string[]): Map<string, number[]> {
    const out = new Map<string, number[]>();
    if (memoryIds.length === 0) {
      return out;
    }
    const placeholders = memoryIds.map(() => '?').join(',');
    const rows = DatabaseUtils.all(
      this.db,
      `
      SELECT memory_id, embedding
      FROM memory_embedding
      WHERE memory_id IN (${placeholders})
      ORDER BY memory_id, created_at DESC
    `,
      memoryIds
    ) as Array<{ memory_id: string; embedding: string }>;

    for (const row of rows) {
      if (out.has(row.memory_id)) {
        continue;
      }
      try {
        const vec = JSON.parse(row.embedding) as number[];
        if (Array.isArray(vec) && vec.length > 0) {
          out.set(row.memory_id, vec);
        }
      } catch {
        /* skip */
      }
    }
    return out;
  }

  insertSemanticMemory(params: {
    id: string;
    content: string;
    importance: number;
    originSourceJson: string;
    ownerId: string | null;
    privacyScope?: string;
  }): void {
    DatabaseUtils.run(
      this.db,
      `
      INSERT INTO memory_item (
        id, type, content, importance, privacy_scope, origin_source,
        owner_id, created_at, is_consolidated
      ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, datetime('now'), 0)
    `,
      [
        params.id,
        params.content,
        params.importance,
        params.privacyScope ?? 'private',
        params.originSourceJson,
        params.ownerId
      ]
    );
  }

  markEpisodicsConsolidated(memoryIds: string[], importanceCap = 0.1): void {
    if (memoryIds.length === 0) {
      return;
    }
    const placeholders = memoryIds.map(() => '?').join(',');
    DatabaseUtils.run(
      this.db,
      `
      UPDATE memory_item
      SET is_consolidated = 1,
          importance = MIN(importance, ?)
      WHERE id IN (${placeholders})
        AND type = 'episodic'
    `,
      [importanceCap, ...memoryIds]
    );
  }
}
