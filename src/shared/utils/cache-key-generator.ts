/**
 * 캐시 키 생성 유틸리티
 * 일관된 캐시 키 형식을 제공하여 캐시 키 생성 로직의 중복을 제거합니다.
 */

/**
 * 관계 그래프 캐시 키 생성 옵션
 */
export interface RelationGraphCacheOptions {
  direction?: 'incoming' | 'outgoing' | 'both';
  relationTypes?: string[];
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

/**
 * 관계 추출 캐시 키 생성 옵션
 */
export interface RelationExtractionCacheOptions {
  method?: string;
  minConfidence?: number;
  candidateLimit?: number;
  relationTypes?: string[] | null;
  immediate?: boolean;
}

/**
 * 캐시 키 생성 유틸리티
 */
export class CacheKeyGenerator {
  /**
   * 관계 그래프 캐시 키 생성
   * 
   * @param memoryId 기억 ID
   * @param options 조회 옵션
   * @returns 캐시 키
   */
  static generateRelationGraphKey(
    memoryId: string,
    options?: RelationGraphCacheOptions
  ): string {
    const optionsKey = JSON.stringify({
      direction: options?.direction ?? 'both',
      relationTypes: options?.relationTypes?.sort(),
      minConfidence: options?.minConfidence,
      limit: options?.limit,
      offset: options?.offset
    });
    return `relation_graph:${memoryId}:${optionsKey}`;
  }

  /**
   * 관계 추출 캐시 키 생성
   * 
   * @param newMemoryId 새로운 기억 ID
   * @param existingMemoryIds 기존 기억 ID 목록
   * @param options 추출 옵션
   * @returns 캐시 키
   */
  static generateRelationExtractionKey(
    newMemoryId: string,
    existingMemoryIds: string[],
    options?: RelationExtractionCacheOptions
  ): string {
    // 기존 메모리 ID 정렬
    const sortedIds = [...existingMemoryIds].sort().join(',');
    
    // 옵션 정규화: 모든 옵션을 정렬하여 일관된 키 생성
    const normalizedOptions: Record<string, unknown> = {
      method: options?.method ?? 'hybrid',
      minConfidence: options?.minConfidence ?? 0.5,
      candidateLimit: options?.candidateLimit ?? 30,
      relationTypes: options?.relationTypes ? [...options.relationTypes].sort() : null
    };
    
    // immediate 옵션도 포함 (캐시 키에 영향을 주므로)
    if (options?.immediate !== undefined) {
      normalizedOptions.immediate = options.immediate;
    }
    
    // JSON.stringify는 객체 키 순서를 보장하므로 정규화된 옵션 사용
    const optionsKey = JSON.stringify(normalizedOptions);
    
    return `relation_extract:${newMemoryId}:${sortedIds}:${optionsKey}`;
  }

  /**
   * LLM 기반 관계 추출 캐시 키 생성
   * 
   * @param newMemoryId 새로운 기억 ID
   * @param existingMemoryIds 기존 기억 ID 목록
   * @returns 캐시 키
   */
  static generateLLMRelationExtractionKey(
    newMemoryId: string,
    existingMemoryIds: string[]
  ): string {
    const sortedIds = [...existingMemoryIds].sort().join(',');
    return `llm_relation:${newMemoryId}:${sortedIds}`;
  }

  /**
   * 임베딩 서비스 캐시 키 생성
   * 
   * @param prefix 캐시 키 접두사 (예: 'embedding', 'openai_embedding')
   * @param text 텍스트
   * @returns 캐시 키
   */
  static generateEmbeddingKey(prefix: string, text: string): string {
    // 텍스트가 너무 긴 경우 해시 사용 (선택적)
    // 현재는 간단하게 prefix와 text를 조합
    return `${prefix}:${text}`;
  }
}
