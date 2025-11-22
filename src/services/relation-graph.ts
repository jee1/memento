/**
 * 관계 그래프 서비스
 * 기억 간의 관계를 저장하고 관리하는 서비스
 * 
 * 주요 기능:
 * - 관계 추가/삭제/조회
 * - 순환 참조 감지 (DFS)
 * - N-hop 관계 탐색 (BFS)
 * - 신뢰도 갱신
 * - 캐싱 계층 (L1: MemoryCache 10분, L2: PersistentCache 7일)
 * - 배치 삽입 최적화
 */

import Database from 'better-sqlite3';
import type {
  MemoryRelation,
  RelationMetadata,
  RelationDirection,
  GetRelationsOptions,
  GetRelatedMemoriesOptions,
  AddRelationOptions,
  IRelationGraph
} from '../types/relation-graph.js';
import type { RelationType } from '../types/relation.js';
import { DatabaseUtils } from '../utils/database.js';
import { CacheService } from './cache-service.js';
import { logger } from '../utils/logger.js';
import {
  isExistingRelationRow,
  isMetadataRow,
  isRelationRow,
  type RelationRow,
  type ExistingRelationRow
} from '../utils/type-guards.js';
import { CacheKeyGenerator } from '../utils/cache-key-generator.js';
import { CONFIDENCE, LIMITS, CACHE } from '../constants/relation-constants.js';

/**
 * 관계 그래프 서비스
 */
export class RelationGraph implements IRelationGraph {
  private db: Database.Database;
  
  // L1 캐시: 메모리 캐시 (TTL 10분)
  private l1Cache: CacheService<MemoryRelation[]>;
  
  // L2 캐시: 영구 캐시 (TTL 7일)
  private l2Cache: CacheService<MemoryRelation[]>;
  
  // 캐시 키 추적: memoryId -> Set<cacheKey>
  // 정확한 캐시 무효화를 위해 사용
  private cacheKeyIndex: Map<string, Set<string>> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    // L1 캐시: 1000개 항목, 10분 TTL
    this.l1Cache = new CacheService<MemoryRelation[]>(CACHE.L1_SIZE, CACHE.L1_TTL_MS);
    // L2 캐시: 5000개 항목, 7일 TTL
    this.l2Cache = new CacheService<MemoryRelation[]>(CACHE.L2_SIZE, CACHE.L2_TTL_MS);
  }

  /**
   * 관계 추가
   * UNIQUE 제약 검증 및 순환 참조 감지를 수행합니다.
   * 
   * 트랜잭션 내에서 실행하여 순환 참조 감지와 관계 추가를 원자적으로 처리합니다.
   * 이를 통해 경쟁 조건을 방지하고 일관성을 보장합니다.
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param options 추가 옵션
   * @returns 추가된 관계 ID
   */
  async addRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    options?: AddRelationOptions
  ): Promise<number> {
    // Given: 입력 검증
    this.validateRelationInput(sourceId, targetId);

    const confidence = options?.confidence ?? CONFIDENCE.DEFAULT;
    const updateOnConflict = options?.updateOnConflict ?? false;
    const allowCyclic = options?.allowCyclic ?? false;

    // When: 트랜잭션 내에서 순환 참조 감지와 관계 추가를 원자적으로 처리
    // BEGIN IMMEDIATE TRANSACTION을 사용하여 배타적 락을 획득하여 경쟁 조건 방지
    // DatabaseUtils.runTransaction이 중첩 트랜잭션을 자동으로 처리하므로
    // 트랜잭션 상태 확인 없이 직접 호출합니다
    return await DatabaseUtils.runTransaction(this.db, async () => {
      // Then: 순환 참조 감지 (트랜잭션 상태 확인)
      if (!allowCyclic) {
        await this.checkForCyclicRelation(sourceId, targetId, relationType);
      }

      // 메타데이터 준비
      const metadata = this.prepareMetadata(options, allowCyclic);
      const metadataJson = JSON.stringify(metadata);

      try {
        return await this.addRelationInternal(
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          metadataJson,
          updateOnConflict,
          allowCyclic
        );
      } catch (error) {
        return await this.handleRelationAddError(
          error,
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          updateOnConflict
        );
      }
    });
  }

  /**
   * 관계 추가 내부 로직
   * 기존 관계 확인 및 새 관계 추가를 수행합니다.
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param confidence 신뢰도
   * @param metadata 메타데이터
   * @param metadataJson 메타데이터 JSON 문자열
   * @param updateOnConflict 충돌 시 업데이트 여부
   * @param allowCyclic 순환 참조 허용 여부
   * @returns 관계 ID
   */
  private async addRelationInternal(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    metadataJson: string,
    updateOnConflict: boolean,
    allowCyclic: boolean
  ): Promise<number> {
    // 기존 관계 확인 및 업데이트
    const existing = this.findExistingRelation(sourceId, targetId, relationType);
    if (existing) {
      return await this.handleExistingRelation(
        existing,
        sourceId,
        targetId,
        relationType,
        confidence,
        metadata,
        updateOnConflict
      );
    }

    // 새 관계 추가
    const relationId = await this.insertNewRelation(
      sourceId,
      targetId,
      relationType,
      confidence,
      metadataJson,
      allowCyclic
    );

    // 캐시 무효화
    this.invalidateCache(sourceId);
    this.invalidateCache(targetId);

    return relationId;
  }

  /**
   * 관계 추가 에러 처리
   * 동시성 문제로 인한 UNIQUE constraint 에러를 처리합니다.
   * 
   * @param error 발생한 에러
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param confidence 신뢰도
   * @param metadata 메타데이터
   * @param updateOnConflict 충돌 시 업데이트 여부
   * @returns 관계 ID 또는 에러를 throw
   */
  private async handleRelationAddError(
    error: unknown,
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    updateOnConflict: boolean
  ): Promise<number> {
    // 동시성 문제로 인한 UNIQUE constraint 에러 처리
    // findExistingRelation과 insertNewRelation 사이에 다른 요청이 관계를 추가한 경우
    // better-sqlite3는 SQLite 에러 코드를 제공하지 않으므로, 에러 메시지와 타입을 모두 확인
    const isUniqueConstraintError = 
      error instanceof Error && 
      (error.message.includes('UNIQUE constraint') || 
       error.message.includes('UNIQUE constraint failed') ||
       (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE');
    
    if (isUniqueConstraintError) {
      // 기존 관계를 다시 확인하여 업데이트 처리
      const existing = this.findExistingRelation(sourceId, targetId, relationType);
      if (existing && updateOnConflict) {
        return await this.handleExistingRelation(
          existing,
          sourceId,
          targetId,
          relationType,
          confidence,
          metadata,
          updateOnConflict
        );
      }
      throw new Error(
        `이미 존재하는 관계입니다: ${sourceId} -> ${targetId} (${relationType}). ` +
        `동시성 문제로 인해 관계가 이미 추가되었습니다.`
      );
    }
    throw error;
  }

  /**
   * 관계 입력 검증
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   */
  private validateRelationInput(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      throw new Error('자기 자신에 대한 관계는 생성할 수 없습니다.');
    }
  }

  /**
   * 순환 참조 확인
   * 트랜잭션 내에서 호출되는 경우 중첩 트랜잭션을 방지합니다.
   * 트랜잭션 상태를 확인합니다.
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   */
  private async checkForCyclicRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<void> {
    // 트랜잭션 내에서 실행 중인 경우, detectCycleInternal을 트랜잭션 없이 호출
    // addRelation이 이미 트랜잭션을 시작했으므로,
    // 트랜잭션 없이 실행되어야 합니다
    const isCyclic = await this.detectCycleInternal(sourceId, targetId, relationType);
    if (isCyclic) {
      throw new Error(`순환 참조가 감지되었습니다: ${sourceId} -> ${targetId} (${relationType})`);
    }
  }

  /**
   * 메타데이터 준비
   * 
   * @param options 추가 옵션
   * @param allowCyclic 순환 참조 허용 여부
   * @returns 준비된 메타데이터
   */
  private prepareMetadata(
    options?: AddRelationOptions,
    allowCyclic?: boolean
  ): RelationMetadata {
    return {
      method: options?.metadata?.method,
      extracted_at: options?.metadata?.extracted_at || new Date().toISOString(),
      cyclic: allowCyclic ? true : undefined,
      evidence: options?.metadata?.evidence,
      ...options?.metadata
    };
  }


  /**
   * 기존 관계 조회
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @returns 기존 관계 정보 또는 null
   */
  private findExistingRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): ExistingRelationRow | null {
    const result = DatabaseUtils.get(this.db, `
      SELECT id, confidence, metadata
      FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (result === null || result === undefined) {
      return null;
    }

    if (isExistingRelationRow(result)) {
      return result;
    }

    // 타입 검증 실패 시 로깅하고 null 반환
    logger.warn('기존 관계 조회 결과 타입 검증 실패', {
      sourceId,
      targetId,
      relationType,
      resultType: typeof result
    });
    return null;
  }

  /**
   * 기존 관계 처리
   * 
   * @param existing 기존 관계 정보
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param confidence 신뢰도
   * @param metadata 메타데이터
   * @param updateOnConflict 충돌 시 업데이트 여부
   * @returns 관계 ID
   */
  private async handleExistingRelation(
    existing: { id: number; confidence: number; metadata: string | null },
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadata: RelationMetadata,
    updateOnConflict: boolean
  ): Promise<number> {
    if (!updateOnConflict) {
      throw new Error(`이미 존재하는 관계입니다: ${sourceId} -> ${targetId} (${relationType})`);
    }

    // 기존 관계 업데이트
    const oldConfidence = existing.confidence;
    const oldMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};
    
    // 신뢰도 개선 이력 추가
    const refinementHistory = oldMetadata.refinement_history || [];
    refinementHistory.push({
      timestamp: new Date().toISOString(),
      old_confidence: oldConfidence,
      new_confidence: confidence,
      reason: '관계 추가 시 업데이트'
    });

    const updatedMetadata: RelationMetadata = {
      ...oldMetadata,
      ...metadata,
      refinement_history: refinementHistory
    };

    DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET confidence = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [confidence, JSON.stringify(updatedMetadata), existing.id]);

    // 캐시 무효화
    this.invalidateCache(sourceId);
    this.invalidateCache(targetId);

    return existing.id;
  }

  /**
   * 새 관계 추가
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param confidence 신뢰도
   * @param metadataJson 메타데이터 JSON 문자열
   * @param allowCyclic 순환 참조 허용 여부
   * @returns 추가된 관계 ID
   */
  private async insertNewRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    confidence: number,
    metadataJson: string,
    allowCyclic: boolean
  ): Promise<number> {
    // 새 관계 추가
    const result = DatabaseUtils.run(this.db, `
      INSERT INTO memory_relation (
        source_id, target_id, relation_type, confidence, metadata
      )
      VALUES (?, ?, ?, ?, ?)
    `, [sourceId, targetId, relationType, confidence, metadataJson]);

    const relationId = result.lastInsertRowid as number;

    // 순환 참조 플래그 업데이트 (필요한 경우)
    if (allowCyclic) {
      await this.updateCyclicFlag(relationId);
    }

    return relationId;
  }


  /**
   * 순환 참조 플래그 업데이트
   * 
   * @param relationId 관계 ID
   */
  private async updateCyclicFlag(relationId: number): Promise<void> {
    // 기존 메타데이터 가져오기
    const result = DatabaseUtils.get(this.db, `
      SELECT metadata FROM memory_relation WHERE id = ?
    `, [relationId]);

    if (!result) {
      logger.warn('순환 참조 플래그 업데이트 실패: 관계를 찾을 수 없습니다', { relationId });
      return;
    }

    if (!isMetadataRow(result)) {
      logger.warn('순환 참조 플래그 업데이트 실패: 타입 검증 실패', { 
        relationId,
        resultType: typeof result
      });
      return;
    }

    const existing = result;
    
    let updatedMetadata: RelationMetadata;
    if (existing.metadata) {
      updatedMetadata = JSON.parse(existing.metadata);
    } else {
      updatedMetadata = {};
    }
    
    updatedMetadata.cyclic = true;
    
    DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET metadata = ?
      WHERE id = ?
    `, [JSON.stringify(updatedMetadata), relationId]);
  }

  /**
   * 관계 조회
   * 
   * @param memoryId 기억 ID
   * @param options 조회 옵션
   * @returns 관계 목록
   */
  async getRelations(
    memoryId: string,
    options?: GetRelationsOptions
  ): Promise<MemoryRelation[]> {
    const direction = options?.direction ?? 'both';
    const relationTypes = options?.relationTypes;
    const minConfidence = options?.minConfidence;
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const bypassCache = options?.bypassCache ?? false;

    // 캐시 우회 옵션이 활성화되지 않은 경우에만 캐시 확인
    if (!bypassCache) {
      // 캐시 키 생성
      const cacheKey = this.generateCacheKey(memoryId, options);
      
      // L1 캐시 확인
      const l1Cached = this.l1Cache.get(cacheKey);
      if (l1Cached) {
        return l1Cached;
      }

      // L2 캐시 확인
      const l2Cached = this.l2Cache.get(cacheKey);
      if (l2Cached) {
        // L1 캐시에도 저장
        this.l1Cache.set(cacheKey, l2Cached);
        return l2Cached;
      }
    }

    // 데이터베이스에서 조회
    let query = '';
    const params: Array<string | number | RelationType> = [];

    if (direction === 'outgoing') {
      query = 'SELECT * FROM memory_relation WHERE source_id = ?';
      params.push(memoryId);
    } else if (direction === 'incoming') {
      query = 'SELECT * FROM memory_relation WHERE target_id = ?';
      params.push(memoryId);
    } else {
      query = `
        SELECT * FROM memory_relation
        WHERE source_id = ? OR target_id = ?
      `;
      params.push(memoryId, memoryId);
    }

    // 관계 유형 필터
    if (relationTypes && relationTypes.length > 0) {
      const placeholders = relationTypes.map(() => '?').join(',');
      query += ` AND relation_type IN (${placeholders})`;
      params.push(...relationTypes);
    }

    // 최소 신뢰도 필터
    if (minConfidence !== undefined) {
      query += ' AND confidence >= ?';
      params.push(minConfidence);
    }

    // 정렬 및 제한
    query += ' ORDER BY confidence DESC, created_at DESC';
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      
      if (offset > 0) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = DatabaseUtils.all(this.db, query, params);
    
    // 타입 가드를 사용하여 안전하게 필터링
    const validRows = rows.filter((row): row is RelationRow => isRelationRow(row));
    
    if (validRows.length !== rows.length) {
      logger.warn('관계 조회 결과 일부 행의 타입 검증 실패', {
        totalRows: rows.length,
        validRows: validRows.length
      });
    }

    const relations: MemoryRelation[] = validRows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      relation_type: row.relation_type as RelationType,
      confidence: row.confidence,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));

    // 캐시 우회 옵션이 활성화되지 않은 경우에만 캐시 저장
    if (!bypassCache) {
      const cacheKey = this.generateCacheKey(memoryId, options);
      // 캐시 저장
      this.l1Cache.set(cacheKey, relations);
      this.l2Cache.set(cacheKey, relations);
      
      // 캐시 키 인덱스에 추가
      this.addCacheKeyToIndex(memoryId, cacheKey);
    }

    return relations;
  }

  /**
   * 관련 기억 조회 (N-hop 관계 탐색)
   * BFS 알고리즘을 사용하여 N-hop 관계를 탐색합니다.
   * 
   * @param memoryId 시작 기억 ID
   * @param options 탐색 옵션
   * @returns 관련 기억 ID 목록과 hop 거리
   */
  async getRelatedMemories(
    memoryId: string,
    options?: GetRelatedMemoriesOptions
  ): Promise<Array<{
    memory_id: string;
    hop_distance: number;
    relation_path: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
    }>;
  }>> {
    const maxHops = options?.maxHops ?? 2;
    const relationTypes = options?.relationTypes;
    const minConfidence = options?.minConfidence;
    const limit = options?.limit;
    const includeCyclic = options?.includeCyclic ?? false;

    // BFS 탐색
    const visited = new Set<string>();
    const queue: Array<{
      memory_id: string;
      hop_distance: number;
      relation_path: Array<{
        source_id: string;
        target_id: string;
        relation_type: RelationType;
      }>;
    }> = [];
    const results: typeof queue = [];

    // 배치 쿼리 최적화: 여러 노드의 관계를 한 번에 조회
    // 노드별 관계를 캐싱하여 중복 쿼리 방지
    const nodeRelationsCache = new Map<string, MemoryRelation[]>();

    // 시작 노드
    queue.push({
      memory_id: memoryId,
      hop_distance: 0,
      relation_path: []
    });
    visited.add(memoryId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.hop_distance > 0) {
        // 시작 노드가 아닌 경우 결과에 추가
        results.push(current);

        if (limit && results.length >= limit) {
          break;
        }
      }

      if (current.hop_distance >= maxHops) {
        continue;
      }

      // 배치 쿼리 최적화: 현재 레벨의 모든 노드 관계를 한 번에 조회
      // 같은 hop_distance를 가진 노드들의 관계를 배치로 조회하여 I/O 오버헤드 감소
      const currentLevelNodes = queue.filter(n => n.hop_distance === current.hop_distance);
      const nodesToQuery = [current.memory_id, ...currentLevelNodes.map(n => n.memory_id)]
        .filter(id => !nodeRelationsCache.has(id));

      if (nodesToQuery.length > 0) {
        // 배치 쿼리: 여러 노드의 관계를 한 번에 조회
        const placeholders = nodesToQuery.map(() => '?').join(',');
        let batchQuery = `
          SELECT * FROM memory_relation
          WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
        `;
        const params: Array<string | number | RelationType> = [
          ...nodesToQuery,
          ...nodesToQuery
        ];

        // 관계 유형 필터 (경로의 모든 관계에 적용)
        // 주의: relationTypes 필터는 경로의 모든 관계에 적용되므로,
        // 경로에 다른 관계 유형이 포함되면 필터링됩니다
        if (relationTypes && relationTypes.length > 0) {
          const typePlaceholders = relationTypes.map(() => '?').join(',');
          batchQuery += ` AND relation_type IN (${typePlaceholders})`;
          params.push(...relationTypes);
        }

        // 최소 신뢰도 필터
        if (minConfidence !== undefined) {
          batchQuery += ' AND confidence >= ?';
          params.push(minConfidence);
        }

        batchQuery += ' ORDER BY confidence DESC';

        const batchRows = DatabaseUtils.all(this.db, batchQuery, params);
        const validRows = batchRows.filter((row): row is RelationRow => isRelationRow(row));

        // 노드별로 관계 분류하여 캐시에 저장
        for (const nodeId of nodesToQuery) {
          const nodeRelations: MemoryRelation[] = validRows
            .filter(row => row.source_id === nodeId || row.target_id === nodeId)
            .map(row => ({
              id: row.id,
              source_id: row.source_id,
              target_id: row.target_id,
              relation_type: row.relation_type as RelationType,
              confidence: row.confidence,
              created_at: new Date(row.created_at),
              updated_at: new Date(row.updated_at),
              metadata: row.metadata ? JSON.parse(row.metadata) : undefined
            }));
          nodeRelationsCache.set(nodeId, nodeRelations);
        }
      }

      // 캐시에서 현재 노드의 관계 가져오기
      const relations = nodeRelationsCache.get(current.memory_id) || [];

      for (const relation of relations) {
        const nextId = relation.source_id === current.memory_id
          ? relation.target_id
          : relation.source_id;

        // 순환 참조 처리
        if (!includeCyclic && relation.metadata?.cyclic) {
          continue;
        }

        // 방문하지 않은 노드만 큐에 추가
        if (!visited.has(nextId)) {
          visited.add(nextId);
          
          const nextPath = [...current.relation_path];
          if (relation.source_id === current.memory_id) {
            nextPath.push({
              source_id: relation.source_id,
              target_id: relation.target_id,
              relation_type: relation.relation_type
            });
          } else {
            nextPath.push({
              source_id: relation.target_id,
              target_id: relation.source_id,
              relation_type: relation.relation_type
            });
          }

          queue.push({
            memory_id: nextId,
            hop_distance: current.hop_distance + 1,
            relation_path: nextPath
          });
        }
      }
    }

    return results;
  }

  /**
   * 관계 삭제
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @returns 삭제 성공 여부
   */
  async removeRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<boolean> {
    const result = DatabaseUtils.run(this.db, `
      DELETE FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (result.changes > 0) {
      // 캐시 무효화
      this.invalidateCache(sourceId);
      this.invalidateCache(targetId);
      return true;
    }

    return false;
  }

  /**
   * 신뢰도 갱신
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param newConfidence 새로운 신뢰도
   * @param reason 갱신 이유
   * @returns 갱신 성공 여부
   */
  async updateConfidence(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    newConfidence: number,
    reason?: string
  ): Promise<boolean> {
    // 기존 관계 조회
    const queryResult = DatabaseUtils.get(this.db, `
      SELECT id, confidence, metadata
      FROM memory_relation
      WHERE source_id = ? AND target_id = ? AND relation_type = ?
    `, [sourceId, targetId, relationType]);

    if (!queryResult) {
      return false;
    }

    // 타입 가드를 사용하여 안전하게 타입 검증
    if (!isExistingRelationRow(queryResult)) {
      logger.warn('신뢰도 갱신: 타입 검증 실패', {
        sourceId,
        targetId,
        relationType,
        resultType: typeof queryResult
      });
      return false;
    }

    const existing = queryResult;
    const oldConfidence = existing.confidence;
    const oldMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};

    // 신뢰도 개선 이력 추가
    const refinementHistory = oldMetadata.refinement_history || [];
    refinementHistory.push({
      timestamp: new Date().toISOString(),
      old_confidence: oldConfidence,
      new_confidence: newConfidence,
      reason: reason || '신뢰도 갱신'
    });

    const updatedMetadata: RelationMetadata = {
      ...oldMetadata,
      refinement_history: refinementHistory
    };

    const updateResult = DatabaseUtils.run(this.db, `
      UPDATE memory_relation
      SET confidence = ?,
          metadata = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newConfidence, JSON.stringify(updatedMetadata), existing.id]);

    if (updateResult.changes > 0) {
      // 캐시 무효화
      this.invalidateCache(sourceId);
      this.invalidateCache(targetId);
      return true;
    }

    return false;
  }

  /**
   * 순환 참조 감지 (DFS)
   * 
   * 트랜잭션 내에서 실행하여 경쟁 조건을 방지합니다.
   * 순환 참조 감지 중에 다른 프로세스/스레드에서 관계가 추가되는 것을 방지합니다.
   * 트랜잭션 격리 수준을 사용합니다.
   * 
   * 성능 최적화:
   * - 최대 탐색 깊이 제한 (기본값: 10)
   * - 대규모 그래프에서 무한 루프 방지
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param maxDepth 최대 탐색 깊이 (기본값: 10)
   * @returns 순환 참조 여부
   */
  /**
   * 순환 참조 감지 내부 로직 (트랜잭션 없이 실행)
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param maxDepth 최대 탐색 깊이
   * @returns 순환 참조 여부
   */
  private async detectCycleInternal(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    maxDepth: number = LIMITS.MAX_CYCLE_DEPTH
  ): Promise<boolean> {
    // 자기 자신에 대한 관계는 순환 참조가 아님
    if (sourceId === targetId) {
      return false;
    }

    // DFS로 순환 참조 탐색
    // targetId에서 sourceId로 가는 경로가 있는지 확인
    const visited = new Set<string>();
    
    // 배치 쿼리 최적화: 여러 노드의 관계를 한 번에 조회
    // 현재 탐색 중인 노드들의 관계를 배치로 조회하여 I/O 오버헤드 감소
    // 노드별 관계를 캐싱하여 중복 쿼리 방지
    const nodeRelations = new Map<string, string[]>();
    
    const dfs = async (currentId: string, target: string, depth: number): Promise<boolean> => {
        // 최대 탐색 깊이 제한 (무한 루프 방지)
        if (depth > maxDepth) {
          logger.warn('순환 참조 감지: 최대 탐색 깊이 초과', {
            sourceId,
            targetId,
            currentId,
            depth,
            maxDepth
          });
          return false;
        }

        if (currentId === target) {
          return true; // 순환 참조 발견
        }

        if (visited.has(currentId)) {
          return false; // 이미 방문한 노드 (순환 경로가 아님)
        }

        visited.add(currentId);

        // 배치 쿼리 최적화: 캐시에 없는 경우에만 배치로 조회
        let targetIds: string[] = [];
        if (nodeRelations.has(currentId)) {
          targetIds = nodeRelations.get(currentId)!;
        } else {
          // 현재 노드에서 나가는 관계 조회 (캐시 우회를 위해 직접 쿼리)
          // 캐시를 사용하면 새로 추가된 관계를 놓칠 수 있으므로 직접 쿼리
          // 트랜잭션 내에서 실행되므로 일관된 스냅샷을 보장
          const rows = DatabaseUtils.all(this.db, `
            SELECT target_id
            FROM memory_relation
            WHERE source_id = ? AND relation_type = ?
          `, [currentId, relationType]);

          // 타입 검증 및 target_id 추출
          for (const row of rows) {
            if (typeof row === 'object' && row !== null && 'target_id' in row) {
              const targetIdValue = (row as { target_id: unknown }).target_id;
              if (typeof targetIdValue === 'string') {
                targetIds.push(targetIdValue);
              }
            }
          }
          
          // 캐시에 저장하여 중복 쿼리 방지
          nodeRelations.set(currentId, targetIds);
        }

        // 재귀적으로 다음 노드 탐색
        for (const nextId of targetIds) {
          if (await dfs(nextId, target, depth + 1)) {
            return true;
          }
        }

        return false;
      };

      // targetId에서 sourceId로 가는 경로가 있는지 확인
      return await dfs(targetId, sourceId, 0);
  }

  /**
   * 순환 참조 감지 (공개 메서드)
   * 트랜잭션을 자동으로 관리합니다.
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param maxDepth 최대 탐색 깊이 (기본값: 10)
   * @returns 순환 참조 여부
   */
  async detectCycle(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    maxDepth: number = LIMITS.MAX_CYCLE_DEPTH
  ): Promise<boolean> {
    // 트랜잭션 내에서 순환 참조 감지를 수행하여 경쟁 조건 방지
    // BEGIN IMMEDIATE TRANSACTION을 사용하여 배타적 락을 획득
    // 이미 트랜잭션이 시작된 경우 중첩 트랜잭션을 방지합니다.
    // 트랜잭션 상태를 확인하여 적절히 처리
    if (DatabaseUtils.isInTransaction(this.db)) {
      // 트랜잭션이 이미 시작된 경우 트랜잭션 없이 실행
      return await this.detectCycleInternal(sourceId, targetId, relationType, maxDepth);
    }

    // 트랜잭션이 시작되지 않은 경우 트랜잭션 내에서 실행
    return await DatabaseUtils.runTransaction(this.db, async () => {
      return await this.detectCycleInternal(sourceId, targetId, relationType, maxDepth);
    });
  }


  /**
   * 캐시 키 생성
   * 공통 유틸리티를 사용하여 일관된 캐시 키를 생성합니다.
   * 
   * @param memoryId 기억 ID
   * @param options 조회 옵션
   * @returns 캐시 키
   */
  private generateCacheKey(memoryId: string, options?: GetRelationsOptions): string {
    return CacheKeyGenerator.generateRelationGraphKey(memoryId, {
      direction: options?.direction,
      relationTypes: options?.relationTypes,
      minConfidence: options?.minConfidence,
      limit: options?.limit,
      offset: options?.offset
    });
  }

  /**
   * 캐시 키를 인덱스에 추가
   * 정확한 캐시 무효화를 위해 사용
   * 
   * @param memoryId 기억 ID
   * @param cacheKey 캐시 키
   */
  private addCacheKeyToIndex(memoryId: string, cacheKey: string): void {
    if (!this.cacheKeyIndex.has(memoryId)) {
      this.cacheKeyIndex.set(memoryId, new Set());
    }
    this.cacheKeyIndex.get(memoryId)!.add(cacheKey);
  }

  /**
   * 캐시 무효화
   * 특정 메모리 ID와 관련된 캐시를 정확하게 무효화합니다.
   * 
   * 최적화 전략:
   * 1. 캐시 키 인덱스를 우선 사용하여 O(1) 접근으로 정확한 캐시 키 삭제
   * 2. 인덱스가 없는 경우에만 패턴 기반 삭제 수행 (fallback)
   * 
   * 성능 고려사항:
   * - 인덱스가 있는 경우: O(n) where n = 해당 memoryId의 캐시 키 수
   * - 인덱스가 없는 경우: O(m) where m = 전체 캐시 키 수 (최악의 경우)
   * - 일반적으로 인덱스가 있으므로 효율적
   * 
   * @param memoryId 기억 ID
   */
  private invalidateCache(memoryId: string): void {
    // 캐시 키 인덱스에서 해당 memoryId의 모든 캐시 키 가져오기
    const cacheKeys = this.cacheKeyIndex.get(memoryId);
    
    if (cacheKeys && cacheKeys.size > 0) {
      // 인덱스에 등록된 모든 캐시 키 삭제 (효율적)
      for (const cacheKey of cacheKeys) {
        this.l1Cache.delete(cacheKey);
        this.l2Cache.delete(cacheKey);
      }
      // 인덱스에서 memoryId 제거
      this.cacheKeyIndex.delete(memoryId);
      return; // 인덱스가 있으면 패턴 기반 삭제 불필요
    }
    
    // 인덱스에 없는 경우를 대비한 fallback: 패턴 기반 삭제
    // (이전에 생성된 캐시나 인덱스가 없던 시점의 캐시 처리)
    // 주의: keys() 메서드는 모든 키를 반환하므로 캐시가 많을 경우 성능 저하 가능
    // 하지만 일반적으로 인덱스가 있으므로 이 경로는 거의 실행되지 않음
    const cacheKeyPrefix = `relation_graph:${memoryId}:`;
    const allL1Keys = this.l1Cache.keys();
    const allL2Keys = this.l2Cache.keys();
    
    for (const key of allL1Keys) {
      if (key.startsWith(cacheKeyPrefix)) {
        this.l1Cache.delete(key);
      }
    }
    
    for (const key of allL2Keys) {
      if (key.startsWith(cacheKeyPrefix)) {
        this.l2Cache.delete(key);
      }
    }
  }

  /**
   * 배치 관계 추가
   * 여러 관계를 한 번에 추가하여 성능을 최적화합니다.
   * 
   * @param relations 추가할 관계 목록
   * @returns 배치 처리 결과 (성공한 관계 ID 목록 및 실패한 관계 정보)
   */
  async addRelationsBatch(
    relations: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      confidence?: number;
      metadata?: RelationMetadata;
    }>
  ): Promise<{
    insertedIds: number[];
    failed: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      error: string;
    }>;
    total: number;
    success: number;
    failedCount: number;
  }> {
    const insertedIds: number[] = [];
    const failed: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      error: string;
    }> = [];

    // 트랜잭션으로 배치 처리
    await DatabaseUtils.runTransaction(this.db, async () => {
      for (const relation of relations) {
        try {
          const id = await this.addRelation(
            relation.source_id,
            relation.target_id,
            relation.relation_type,
            {
              confidence: relation.confidence,
              metadata: relation.metadata,
              updateOnConflict: true,
              allowCyclic: false
            }
          );
          insertedIds.push(id);
        } catch (error) {
          // 실패한 관계를 추적하여 결과에 포함
          const errorMessage = error instanceof Error ? error.message : String(error);
          failed.push({
            source_id: relation.source_id,
            target_id: relation.target_id,
            relation_type: relation.relation_type,
            error: errorMessage
          });
          
          logger.warn('관계 추가 실패', {
            source_id: relation.source_id,
            target_id: relation.target_id,
            relation_type: relation.relation_type,
            error: errorMessage
          });
        }
      }
      return { insertedIds, failed };
    });

    return {
      insertedIds,
      failed,
      total: relations.length,
      success: insertedIds.length,
      failedCount: failed.length
    };
  }
}
