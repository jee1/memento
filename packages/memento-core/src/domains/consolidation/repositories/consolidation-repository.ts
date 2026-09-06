/**
 * Sleep consolidation — DB 접근
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { embeddingColumnToNumbers } from '../../../shared/utils/embedding-serialization.js';

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
  /** 요청한 provider·model 로 만들어진 저장 벡터. 그런 행이 없으면 undefined. */
  embedding?: number[];
}

/**
 * 저장 벡터를 고르는 기준.
 *
 * 벡터 공간이 다르면 코사인 값이 무의미하므로, 비교 대상 벡터를 만든 provider·model 과
 * 같은 행만 써야 한다 (#889). provider 를 알 수 없으면 model 만으로 거른다.
 */
export interface StoredEmbeddingFilter {
  provider?: string;
  model?: string;
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
   *
   * 저장된 벡터를 함께 읽어 온다. 병합 후보 탐색에 필요한 것은 코사인 유사도뿐이고
   * 모든 후보는 저장 시점에 이미 임베딩되어 있으므로, 호출부에서 후보마다 임베딩을
   * 다시 만들 이유가 없다. 다시 만들면 클러스터 하나당 시맨틱 기억 수만큼 모델 추론이
   * 돌아 CPU 를 태운다 (#917: 3,902건 × 13ms).
   */
  findSemanticsByOwner(
    ownerId: string | null,
    embeddingFilter: StoredEmbeddingFilter
  ): SemanticOwnerRow[] {
    const joinConditions = ["me.memory_id = mi.id", "COALESCE(me.model, '') = COALESCE(?, '')"];
    const joinParams: Array<string | null> = [embeddingFilter.model ?? null];
    if (embeddingFilter.provider) {
      joinConditions.push('me.embedding_provider = ?');
      joinParams.push(embeddingFilter.provider);
    }

    const rows = DatabaseUtils.all(
      this.db,
      `
      SELECT
        mi.id AS id,
        mi.content AS content,
        COALESCE(mi.origin_source, '{}') AS originSource,
        mi.owner_id AS ownerId,
        me.embedding AS embedding
      FROM memory_item mi
      LEFT JOIN memory_embedding me ON ${joinConditions.join(' AND ')}
      WHERE mi.type = 'semantic'
        AND (mi.is_deleted IS NULL OR mi.is_deleted = 0)
        AND COALESCE(mi.owner_id, '') = COALESCE(?, '')
      ORDER BY mi.created_at ASC
    `,
      [...joinParams, ownerId ?? null]
    ) as Array<{
      id: string;
      content: string;
      originSource: string;
      ownerId: string | null;
      embedding: Buffer | null;
    }>;

    // UNIQUE 는 (memory_id, embedding_provider, projection_type) 이라 provider 를 고정해도
    // projection_type 이 다른 행이 둘 이상 붙을 수 있다. 시맨틱 하나에 행 하나로 접되,
    // 벡터가 있는 행을 우선한다.
    const byId = new Map<string, SemanticOwnerRow>();
    for (const row of rows) {
      const vec = embeddingColumnToNumbers(row.embedding);
      const existing = byId.get(row.id);
      if (!existing) {
        byId.set(row.id, {
          id: row.id,
          content: row.content,
          originSource: row.originSource,
          ownerId: row.ownerId,
          embedding: vec
        });
        continue;
      }
      if (!existing.embedding && vec) {
        existing.embedding = vec;
      }
    }
    return Array.from(byId.values());
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
    ) as Array<{ memory_id: string; embedding: Buffer | null }>;

    for (const row of rows) {
      if (out.has(row.memory_id)) {
        continue;
      }
      const vec = embeddingColumnToNumbers(row.embedding);
      if (vec) {
        out.set(row.memory_id, vec);
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
        owner_id, created_at, is_consolidated) VALUES (?, 'semantic', ?, ?, ?, ?, ?, datetime('now'), 0)
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
