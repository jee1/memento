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
import {
  EmbeddingReindexService,
  ID_CHUNK_SIZE,
  chunkedIn,
  expectedDimensions,
  normalizeProvider,
} from '../../embedding/services/embedding-reindex-service.js';
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

/** 옵션값이 있으면 그대로, 없으면 env 플래그, 그것도 없으면 기본값 — 0~1로 clamp */
function resolveRatio(optionValue: number | undefined, envName: string, fallback: number): number {
  return clamp01(optionValue ?? readEnvRatio(envName, fallback));
}

export class IntrospectionHealingService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: MemoryEmbeddingService,
    private readonly forgettingEventRepository: ForgettingEventRepository = new ForgettingEventRepository(),
  ) {}

  async heal(options: IntrospectionHealOptions = {}): Promise<IntrospectionHealResult> {
    const dryRun = options.dryRun ?? true;
    const provider = normalizeProvider(options.provider ?? mementoConfig.embeddingProvider);
    const demoteFactor = resolveRatio(options.demoteFactor, 'INTROSPECTION_HEAL_DEMOTE_FACTOR', 0.8);
    const minImportance = resolveRatio(options.minImportance, 'INTROSPECTION_HEAL_MIN_IMPORTANCE', 0.1);
    const softDeleteImportanceThreshold = resolveRatio(
      options.softDeleteImportanceThreshold, 'INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD', 0.3,
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

    // re-embed는 임베딩 생성에서 await가 걸리므로 트랜잭션 밖에서 실행 (락 보유 시간 최소화).
    // soft-delete·demote는 순수 동기 쓰기라 하나의 트랜잭션으로 묶어 커밋 횟수를 줄인다.
    await this.applyReEmbed(result, provider);
    await DatabaseUtils.runTransaction(this.db, () => {
      this.applySoftDelete(result);
      this.applyDemote(result, rowById, demoteFactor, minImportance);
    });

    return result;
  }

  private loadMemoryRows(ids: string[]): Map<string, HealMemoryRow> {
    const rows = chunkedIn(ids, ID_CHUNK_SIZE, (chunk, placeholders) => DatabaseUtils.all(
      this.db,
      `SELECT id, importance, pinned FROM memory_item WHERE id IN (${placeholders}) AND COALESCE(is_deleted, 0) = 0`,
      chunk,
    ) as HealMemoryRow[]);
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * #713 vec 계약(embedding_provider + projection_type='native' + dimensions=기대차원)을
   * 만족하는 행이 없는 ID를 "임베딩 누락·차원 불일치"로 판정한다 (EmbeddingReindexService의
   * hasNativeEmbeddingRow/findSemanticRelationEndpointsMissingEmbedding과 동일 조건).
   */
  private findMissingEmbeddingIds(ids: string[], provider: EmbeddingProvider): Set<string> {
    const dimensions = expectedDimensions(provider);
    const present = new Set(chunkedIn(ids, ID_CHUNK_SIZE, (chunk, placeholders) => (DatabaseUtils.all(
      this.db,
      `SELECT DISTINCT memory_id FROM memory_embedding
       WHERE memory_id IN (${placeholders}) AND embedding_provider = ? AND projection_type = 'native' AND dimensions = ?`,
      [...chunk, provider, dimensions],
    ) as { memory_id: string }[]).map((row) => row.memory_id)));
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
