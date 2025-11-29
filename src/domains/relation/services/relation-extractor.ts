/**
 * 관계 추출 메인 서비스
 * 하이브리드 방식으로 관계를 추출합니다 (규칙 기반 → LLM fallback)
 * 
 * 추출 전략:
 * 1. 규칙 기반 추출 시도 (빠르고 비용 효율적)
 * 2. 규칙 기반 결과가 없거나 신뢰도가 낮으면 LLM fallback
 * 3. 타입별 관계 유형 필터링 적용
 */

import type {
  RelationCandidate,
  RelationType,
  IRelationExtractor,
  ExtractOptions
} from '../../../shared/types/relation.js';
import { isApplicableRelationType, MEMORY_TYPE_RELATION_MAP } from '../../../shared/types/relation.js';
import type { MemoryType, MemoryItem } from '../../../shared/types/index.js';
import { RuleBasedRelationExtractor } from './rule-based-relation-extractor.js';
import { LLMBasedRelationExtractor } from './llm-based-relation-extractor.js';
import { CoreMemoryCacheService } from '../../memory/services/core-memory-cache-service.js';
import { logger } from '../../../shared/utils/logger.js';
import { CacheKeyGenerator } from '../../../shared/utils/cache-key-generator.js';
import { CONFIDENCE, LIMITS, CACHE } from '../../../shared/constants/relation-constants.js';

/**
 * 관계 추출 메인 서비스
 */
export class RelationExtractor implements IRelationExtractor {
  private readonly ruleExtractor: RuleBasedRelationExtractor;
  private readonly llmExtractor: LLMBasedRelationExtractor;
  private readonly cache: CoreMemoryCacheService<RelationCandidate[]>;

  constructor(
    ruleExtractor?: RuleBasedRelationExtractor,
    llmExtractor?: LLMBasedRelationExtractor
  ) {
    this.ruleExtractor = ruleExtractor ?? new RuleBasedRelationExtractor();
    this.llmExtractor = llmExtractor ?? new LLMBasedRelationExtractor();
    // 캐시: 1000개 항목, 7일 TTL
    this.cache = new CoreMemoryCacheService<RelationCandidate[]>(CACHE.EXTRACTION_SIZE, CACHE.EXTRACTION_TTL_MS);
  }

  /**
   * 새로운 기억과 기존 기억들 간의 관계를 추출합니다.
   * 하이브리드 방식: 규칙 기반 먼저 시도, 실패 시 LLM fallback
   * 
   * @param newMemory 새로운 기억
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션
   * @returns 관계 후보 목록
   */
  async extractRelations(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    options?: ExtractOptions
  ): Promise<RelationCandidate[]> {
    if (existingMemories.length === 0) {
      return [];
    }

    const method = options?.method ?? 'hybrid';
    const minConfidence = options?.minConfidence ?? CONFIDENCE.MIN_RULE_BASED;
    const immediate = options?.immediate ?? false;

    // 타입별 관계 유형 필터링
    const applicableTypes = this.getApplicableRelationTypes(newMemory.type, options?.relationTypes);

    if (applicableTypes.length === 0) {
      return [];
    }

    // 캐시 키 생성 (즉시 처리인 경우에만 캐싱)
    if (immediate) {
      const cacheKey = this.generateCacheKey(newMemory.id, existingMemories.map(m => m.id), options);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug('관계 추출 캐시 히트', { cacheKey });
        return cached;
      }
    }

    // 관계 유형 필터링이 포함된 옵션 생성
    // MiniLM 기반 후보 필터링을 위해 candidateLimit 기본값 설정
    const extractOptions: ExtractOptions = {
      ...options,
      relationTypes: applicableTypes,
      candidateLimit: options?.candidateLimit ?? LIMITS.LLM_CANDIDATE_DEFAULT // MiniLM 필터링을 위한 기본값
    };

    // 추출 방법에 따라 분기
    if (method === 'rule') {
      return await this.ruleExtractor.extractRelations(newMemory, existingMemories, extractOptions);
    }

    if (method === 'llm') {
      // LLM만 사용하는 경우, LLM이 사용 가능한지 확인
      if (!this.llmExtractor.isAvailable()) {
        throw new Error('LLM 서비스가 사용 불가능합니다. 규칙 기반 추출을 사용하거나 API 키를 설정해주세요.');
      }
      return await this.llmExtractor.extractRelations(newMemory, existingMemories, extractOptions);
    }

    // hybrid 방식: 규칙 기반 먼저 시도
    const ruleCandidates = await this.ruleExtractor.extractRelations(
      newMemory,
      existingMemories,
      extractOptions
    );

    // 규칙 기반 결과 평가
    const hasHighConfidenceResults = ruleCandidates.some(c => c.confidence >= minConfidence);
    const hasAnyResults = ruleCandidates.length > 0;

    // 규칙 기반 결과가 충분하면 반환
    if (hasHighConfidenceResults) {
      logger.info('규칙 기반 추출 성공', { 
        relationCount: ruleCandidates.length,
        memoryId: newMemory.id 
      });
      const filtered = ruleCandidates.filter(c => c.confidence >= minConfidence);
      
      // 캐시 저장 (즉시 처리인 경우에만)
      if (immediate) {
        const cacheKey = this.generateCacheKey(newMemory.id, existingMemories.map(m => m.id), options);
        this.cache.set(cacheKey, filtered);
      }
      
      return filtered;
    }

    // 규칙 기반 결과가 없거나 신뢰도가 낮으면 LLM fallback
    if (!hasAnyResults || !hasHighConfidenceResults) {
      // LLM이 사용 가능한지 확인
      if (!this.llmExtractor.isAvailable()) {
        logger.info('LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환', { memoryId: newMemory.id });
        return ruleCandidates;
      }

      logger.info('규칙 기반 결과 부족, LLM fallback 시도', { 
        ruleCandidateCount: ruleCandidates.length,
        memoryId: newMemory.id 
      });
      
      try {
        const llmCandidates = await this.llmExtractor.extractRelations(
          newMemory,
          existingMemories,
          extractOptions
        );

        // LLM 결과와 규칙 기반 결과 병합 (중복 제거)
        const mergedCandidates = this.mergeCandidates(ruleCandidates, llmCandidates);
        const filtered = mergedCandidates.filter(c => c.confidence >= minConfidence);
        
        logger.info('LLM fallback 완료', { 
          totalRelations: filtered.length,
          memoryId: newMemory.id 
        });
        
        // 캐시 저장 (즉시 처리인 경우에만)
        if (immediate) {
          const cacheKey = this.generateCacheKey(newMemory.id, existingMemories.map(m => m.id), options);
          this.cache.set(cacheKey, filtered);
        }
        
        return filtered;
      } catch (error) {
        logger.error('LLM fallback 실패, 규칙 기반 결과 반환', { 
          error: error instanceof Error ? error.message : String(error),
          memoryId: newMemory.id 
        });
        return ruleCandidates;
      }
    }

    return ruleCandidates;
  }

  /**
   * 기억 타입에 적용 가능한 관계 유형을 반환합니다.
   * 
   * @param memoryType 기억 타입
   * @param requestedTypes 요청된 관계 유형 (없으면 모든 적용 가능한 타입 반환)
   * @returns 적용 가능한 관계 유형 목록
   */
  private getApplicableRelationTypes(
    memoryType: MemoryType,
    requestedTypes?: RelationType[]
  ): RelationType[] {
    const defaultTypes = MEMORY_TYPE_RELATION_MAP[memoryType];

    if (!requestedTypes) {
      return defaultTypes;
    }

    // 요청된 타입 중에서 적용 가능한 타입만 필터링
    return requestedTypes.filter(type => isApplicableRelationType(memoryType, type));
  }

  /**
   * 규칙 기반 결과와 LLM 결과를 병합합니다.
   * 동일한 관계 (source_id, target_id, relation_type이 동일)는 중복 제거하고,
   * 신뢰도가 높은 것을 우선합니다.
   * 
   * @param ruleCandidates 규칙 기반 결과
   * @param llmCandidates LLM 결과
   * @returns 병합된 결과
   */
  private mergeCandidates(
    ruleCandidates: RelationCandidate[],
    llmCandidates: RelationCandidate[]
  ): RelationCandidate[] {
    const merged = new Map<string, RelationCandidate>();

    // 규칙 기반 결과 추가
    for (const candidate of ruleCandidates) {
      const key = `${candidate.source_id}:${candidate.target_id}:${candidate.relation_type}`;
      merged.set(key, candidate);
    }

    // LLM 결과 추가 (중복이면 신뢰도가 높은 것으로 교체)
    for (const candidate of llmCandidates) {
      const key = `${candidate.source_id}:${candidate.target_id}:${candidate.relation_type}`;
      const existing = merged.get(key);

      if (!existing || candidate.confidence > existing.confidence) {
        merged.set(key, candidate);
      }
    }

    // 신뢰도 내림차순 정렬
    return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 캐시 키 생성
   * 공통 유틸리티를 사용하여 일관된 캐시 키를 생성합니다.
   * 
   * @param newMemoryId 새로운 기억 ID
   * @param existingMemoryIds 기존 기억 ID 목록
   * @param options 추출 옵션
   * @returns 캐시 키
   */
  private generateCacheKey(
    newMemoryId: string,
    existingMemoryIds: string[],
    options?: ExtractOptions
  ): string {
    return CacheKeyGenerator.generateRelationExtractionKey(newMemoryId, existingMemoryIds, {
      method: options?.method,
      minConfidence: options?.minConfidence,
      candidateLimit: options?.candidateLimit,
      relationTypes: options?.relationTypes,
      immediate: options?.immediate
    });
  }

  /**
   * 배치 관계 추출 (여러 기억을 묶어서 처리)
   * 비동기 배치 처리로 성능 최적화
   * 
   * @param newMemories 새로운 기억 목록
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션 (batchSize 포함 가능)
   * @returns 각 새로운 기억별 관계 후보 맵
   */
  async extractRelationsBatch(
    newMemories: MemoryItem[],
    existingMemories: MemoryItem[],
    options?: ExtractOptions & { batchSize?: number }
  ): Promise<Map<string, RelationCandidate[]>> {
    const results = new Map<string, RelationCandidate[]>();
    // 배치 크기를 옵션에서 가져오거나, 환경 변수에서 가져오거나, 기본값 사용
    const batchSize = options?.batchSize ?? 
      (process.env.RELATION_EXTRACT_BATCH_SIZE ? parseInt(process.env.RELATION_EXTRACT_BATCH_SIZE, 10) : LIMITS.BATCH_SIZE_DEFAULT);
    const batches: MemoryItem[][] = [];

    // 배치로 나누기
    for (let i = 0; i < newMemories.length; i += batchSize) {
      batches.push(newMemories.slice(i, i + batchSize));
    }

    // 각 배치 처리 (병렬 처리)
    for (const batch of batches) {
      const promises = batch.map(memory =>
        this.extractRelations(memory, existingMemories, {
          ...options,
          immediate: true // 배치 처리 시 캐싱 활성화
        })
      );

      const batchResults = await Promise.all(promises);
      
      for (let i = 0; i < batch.length && i < batchResults.length; i++) {
        const memory = batch[i];
        const result = batchResults[i];
        if (memory && result) {
          results.set(memory.id, result);
        }
      }
    }

    return results;
  }
}
