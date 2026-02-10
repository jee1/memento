/**
 * Meta Memory Introspection Service (Issue #21)
 *
 * M2 모듈: M1(기억 저장소)을 스캔하여 신뢰도 평가·고실패 메모리 식별·요약을 제공합니다.
 * BatchScheduler에서 주기적으로 호출하거나, 도구에서 수동 호출할 수 있습니다.
 */

import Database from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';

/** M2 스캔 옵션 */
export interface MetaMemoryIntrospectionScanOptions {
  /** 에이전트 ID (향후 다중 에이전트 시 필터용, 현재는 memory_item에 owner_id 없어도 meta_memory_stats만 사용) */
  agentId?: string;
  /** 저신뢰 임계값: avg_confidence < 이 값이면 lowConfidenceMemoryIds에 포함 (기본: 0.5) */
  lowConfidenceThreshold?: number;
  /** 고실패 임계값: failure_count >= 이 값이면 highFailureMemoryIds에 포함 (기본: 2) */
  highFailureCountThreshold?: number;
  /** 최대 조회 건수 (기본: 1000) */
  limit?: number;
}

/** M2 스캔 결과 */
export interface MetaMemoryIntrospectionScanResult {
  /** 저신뢰 메모리 ID 목록 (avg_confidence < 임계값) */
  lowConfidenceMemoryIds: string[];
  /** 고실패 메모리 ID 목록 (failure_count >= 임계값) */
  highFailureMemoryIds: string[];
  /** 요약 문자열 (에이전트/도구 표시용) */
  summary: string;
}

/**
 * M2 자기성찰 스캔 서비스
 *
 * meta_memory_stats를 읽어 저신뢰·고실패 메모리를 식별하고 요약합니다.
 */
export class MetaMemoryIntrospectionService {
  /**
   * M1(기억 저장소) 스캔: 저신뢰/고실패 메모리 식별 및 요약
   *
   * @param db 데이터베이스 인스턴스
   * @param options 스캔 옵션
   * @returns 스캔 결과 (lowConfidenceMemoryIds, highFailureMemoryIds, summary)
   */
  static async runScan(
    db: Database.Database,
    options: MetaMemoryIntrospectionScanOptions = {}
  ): Promise<MetaMemoryIntrospectionScanResult> {
    // 옵션 검증: 외부/설정 입력 시 비정상 값 방지 (보안·안정성)
    const rawLow = options.lowConfidenceThreshold ?? 0.5;
    const lowConfidenceThreshold =
      typeof rawLow === 'number' && !Number.isNaN(rawLow) && rawLow >= 0 && rawLow <= 1
        ? rawLow
        : 0.5;
    const rawHigh = options.highFailureCountThreshold ?? 2;
    const highFailureCountThreshold =
      typeof rawHigh === 'number' && !Number.isNaN(rawHigh) && rawHigh >= 0
        ? Math.floor(rawHigh)
        : 2;
    const rawLimit = options.limit ?? 1000;
    const limit =
      typeof rawLimit === 'number' && !Number.isNaN(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), 10000)
        : 1000;

    const lowConfidenceMemoryIds: string[] = [];
    const highFailureMemoryIds: string[] = [];

    try {
      // 저신뢰: avg_confidence < 임계값
      const lowStmt = db.prepare(`
        SELECT memory_id
        FROM meta_memory_stats
        WHERE avg_confidence < ?
        ORDER BY avg_confidence ASC
        LIMIT ?
      `);
      const lowRows = lowStmt.all(lowConfidenceThreshold, limit) as { memory_id: string }[];
      lowConfidenceMemoryIds.push(...lowRows.map((r) => r.memory_id));

      // 고실패: failure_count >= 임계값
      const highFailStmt = db.prepare(`
        SELECT memory_id
        FROM meta_memory_stats
        WHERE failure_count >= ?
        ORDER BY failure_count DESC
        LIMIT ?
      `);
      const highFailRows = highFailStmt.all(
        highFailureCountThreshold,
        limit
      ) as { memory_id: string }[];
      highFailureMemoryIds.push(...highFailRows.map((r) => r.memory_id));
    } catch (err) {
      logger.error('MetaMemoryIntrospectionService: runScan 실패', {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }

    const summary =
      `저신뢰 메모리 ${lowConfidenceMemoryIds.length}건, 고실패 메모리 ${highFailureMemoryIds.length}건. ` +
      (lowConfidenceMemoryIds.length > 0 || highFailureMemoryIds.length > 0
        ? '재검토 또는 최신 정보 반영을 권장합니다.'
        : '현재 플래그할 메모리가 없습니다.');

    return {
      lowConfidenceMemoryIds,
      highFailureMemoryIds,
      summary
    };
  }
}
