/**
 * Introspection Healing Service (Issue #728)
 *
 * meta_memory_introspection 스캔(저신뢰·고실패 메모리)을 실제 치유 액션으로 전환한다:
 * re-embed(임베딩 누락·차원 불일치) / soft-delete(고실패+비핀+저importance) /
 * demote(importance 하향) / review(pinned이거나 이미 하한 도달, 수동 검토용).
 *
 * dry-run(기본값)에서는 DB를 변경하지 않고 분류 결과만 반환한다.
 */

import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { MetaMemoryIntrospectionService } from './meta-memory-introspection-service.js';
import type { MemoryEmbeddingService } from './memory-embedding-service.js';
import { EmbeddingReindexService } from '../../embedding/services/embedding-reindex-service.js';
import {
  ForgettingEventRepository,
} from '../../forgetting/repositories/forgetting-event-repository.js';

export const INTROSPECTION_HEAL_POLICY_NAME = 'introspection-heal';

export interface IntrospectionHealOptions {
  /** 시뮬레이션 모드 (DB 변경 없음). 기본 true — 명시적으로 false를 줘야 실행됨. */
  dryRun?: boolean;
  provider?: EmbeddingProvider;
  lowConfidenceThreshold?: number;
  highFailureCountThreshold?: number;
  /** demote 시 importance 곱셈 계수. 기본 env INTROSPECTION_HEAL_DEMOTE_FACTOR ?? 0.8 */
  demoteFactor?: number;
  /** demote 하한선. 기본 env INTROSPECTION_HEAL_MIN_IMPORTANCE ?? 0.1 */
  minImportance?: number;
  /** soft-delete 판단 importance 상한. 기본 env INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD ?? 0.3 */
  softDeleteImportanceThreshold?: number;
}

export interface IntrospectionHealResult {
  dryRun: boolean;
  provider: EmbeddingProvider;
  scanned: { lowConfidence: number; highFailure: number; union: number };
  reEmbed: { memoryIds: string[]; storedCount: number; failedCount: number };
  softDelete: { memoryIds: string[]; softDeletedCount: number };
  demote: { memoryIds: string[]; demotedCount: number };
  /** pinned이거나 이미 importance 하한에 도달해 자동 조치 대상이 아닌 ID (수동 검토용) */
  review: { memoryIds: string[] };
  errors: string[];
}

interface HealMemoryRow {
  id: string;
  importance: number;
  pinned: number;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function readEnvRatio(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** SQLite 파라미터 상한(기본 999) 회피용 청크 크기 */
const ID_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class IntrospectionHealingService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: MemoryEmbeddingService,
    private readonly forgettingEventRepository: ForgettingEventRepository = new ForgettingEventRepository(),
  ) {}

  async heal(options: IntrospectionHealOptions = {}): Promise<IntrospectionHealResult> {
    const dryRun = options.dryRun ?? true;
    const provider = options.provider ?? mementoConfig.embeddingProvider;
    const demoteFactor = clamp01(options.demoteFactor ?? readEnvRatio('INTROSPECTION_HEAL_DEMOTE_FACTOR', 0.8));
    const minImportance = clamp01(options.minImportance ?? readEnvRatio('INTROSPECTION_HEAL_MIN_IMPORTANCE', 0.1));
    const softDeleteImportanceThreshold = clamp01(
      options.softDeleteImportanceThreshold ?? readEnvRatio('INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD', 0.3),
    );

    const scan = await MetaMemoryIntrospectionService.runScan(this.db, {
      lowConfidenceThreshold: options.lowConfidenceThreshold,
      highFailureCountThreshold: options.highFailureCountThreshold,
    });
    const lowSet = new Set(scan.lowConfidenceMemoryIds);
    const highSet = new Set(scan.highFailureMemoryIds);
    const unionIds = Array.from(new Set([...lowSet, ...highSet]));

    const result: IntrospectionHealResult = {
      dryRun,
      provider,
      scanned: { lowConfidence: lowSet.size, highFailure: highSet.size, union: unionIds.length },
      reEmbed: { memoryIds: [], storedCount: 0, failedCount: 0 },
      softDelete: { memoryIds: [], softDeletedCount: 0 },
      demote: { memoryIds: [], demotedCount: 0 },
      review: { memoryIds: [] },
      errors: [],
    };

    if (unionIds.length === 0) {
      return result;
    }

    const rowById = this.loadMemoryRows(unionIds);
    const missingEmbeddingIds = this.findMissingEmbeddingIds(unionIds, provider);

    for (const id of unionIds) {
      const row = rowById.get(id);
      // 스캔 이후 이미 hard-delete되었거나 소프트 삭제된 경우 (join에서 제외됨) — 치유 불필요
      if (!row) continue;

      if (missingEmbeddingIds.has(id)) {
        result.reEmbed.memoryIds.push(id);
      } else if (row.pinned) {
        // pinned는 기존 ForgettingPolicyService와 동일하게 자동 조치 대상에서 완전 제외
        result.review.memoryIds.push(id);
      } else if (highSet.has(id) && row.importance < softDeleteImportanceThreshold) {
        result.softDelete.memoryIds.push(id);
      } else if (row.importance > minImportance) {
        result.demote.memoryIds.push(id);
      } else {
        result.review.memoryIds.push(id);
      }
    }

    if (dryRun) {
      return result;
    }

    await this.applyReEmbed(result, provider);
    this.applySoftDelete(result);
    this.applyDemote(result, rowById, demoteFactor, minImportance);

    return result;
  }

  private loadMemoryRows(ids: string[]): Map<string, HealMemoryRow> {
    const rowById = new Map<string, HealMemoryRow>();
    for (const idChunk of chunk(ids, ID_CHUNK_SIZE)) {
      const placeholders = idChunk.map(() => '?').join(',');
      const rows = DatabaseUtils.all(
        this.db,
        `SELECT id, importance, pinned FROM memory_item WHERE id IN (${placeholders}) AND COALESCE(is_deleted, 0) = 0`,
        idChunk,
      ) as HealMemoryRow[];
      for (const row of rows) rowById.set(row.id, row);
    }
    return rowById;
  }

  private findMissingEmbeddingIds(ids: string[], provider: EmbeddingProvider): Set<string> {
    const present = new Set<string>();
    for (const idChunk of chunk(ids, ID_CHUNK_SIZE)) {
      const placeholders = idChunk.map(() => '?').join(',');
      const rows = DatabaseUtils.all(
        this.db,
        `SELECT DISTINCT memory_id FROM memory_embedding
         WHERE memory_id IN (${placeholders}) AND embedding_provider = ? AND projection_type = 'native'`,
        [...idChunk, provider],
      ) as { memory_id: string }[];
      for (const row of rows) present.add(row.memory_id);
    }
    return new Set(ids.filter((id) => !present.has(id)));
  }

  private async applyReEmbed(result: IntrospectionHealResult, provider: EmbeddingProvider): Promise<void> {
    if (result.reEmbed.memoryIds.length === 0) return;
    try {
      const reindexService = new EmbeddingReindexService(this.db, this.embeddingService);
      const reindexResult = await reindexService.reindexByIds(result.reEmbed.memoryIds, { provider, dryRun: false });
      result.reEmbed.storedCount = reindexResult.storedCount;
      result.reEmbed.failedCount = reindexResult.failedCount;
    } catch (error) {
      result.errors.push(`re-embed 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private applySoftDelete(result: IntrospectionHealResult): void {
    const now = new Date().toISOString();
    for (const id of result.softDelete.memoryIds) {
      try {
        const updated = DatabaseUtils.run(
          this.db,
          `UPDATE memory_item SET is_deleted = 1, deleted_at = ?, last_accessed = CURRENT_TIMESTAMP
           WHERE id = ? AND COALESCE(pinned, 0) = 0`,
          [now, id],
        );
        if (updated.changes > 0) {
          this.forgettingEventRepository.insert(this.db, {
            memory_id: id,
            action: 'soft',
            reason: 'introspection_heal',
            policy: INTROSPECTION_HEAL_POLICY_NAME,
            forget_score: null,
            ttl_days: null,
            metadata_json: JSON.stringify({ deleted_at: now }),
          });
          result.softDelete.softDeletedCount++;
        }
      } catch (error) {
        result.errors.push(`soft-delete 실패(${id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private applyDemote(
    result: IntrospectionHealResult,
    rowById: Map<string, HealMemoryRow>,
    demoteFactor: number,
    minImportance: number,
  ): void {
    for (const id of result.demote.memoryIds) {
      try {
        const row = rowById.get(id);
        if (!row) continue;
        const newImportance = Math.max(minImportance, row.importance * demoteFactor);
        const updated = DatabaseUtils.run(
          this.db,
          `UPDATE memory_item SET importance = ? WHERE id = ?`,
          [newImportance, id],
        );
        if (updated.changes > 0) {
          result.demote.demotedCount++;
        }
      } catch (error) {
        result.errors.push(`demote 실패(${id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
