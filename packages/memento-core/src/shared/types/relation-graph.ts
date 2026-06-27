/**
 * 관계 그래프 타입 정의
 * 기억 간의 관계를 저장하고 관리하기 위한 타입들
 */

import type { RelationType, RelationCategory } from './relation.js';
import type { MemoryType } from './index.js';

/**
 * 메모리 관계 (데이터베이스 저장용)
 */
export interface MemoryRelation {
  id: number;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  confidence: number; // 0.0~1.0
  created_at: Date;
  updated_at: Date;
  metadata?: RelationMetadata;
}

/**
 * 관계 메타데이터 (JSON 형식으로 저장)
 */
export interface RelationMetadata {
  /**
   * 추출 방법 ('rule' | 'llm')
   */
  method?: 'rule' | 'llm';
  
  /**
   * 추출 시점 타임스탬프
   */
  extracted_at?: string;
  
  /**
   * 순환 참조 여부
   */
  cyclic?: boolean;
  
  /**
   * 추출 근거 (키워드 또는 LLM 설명)
   */
  evidence?: string;
  
  /**
   * 신뢰도 개선 이력
   */
  refinement_history?: Array<{
    timestamp: string;
    old_confidence: number;
    new_confidence: number;
    reason: string;
  }>;
  
  /**
   * 기타 메타데이터
   */
  [key: string]: unknown;
}

/**
 * 관계 조회 방향
 */
export type RelationDirection = 'outgoing' | 'incoming' | 'both';

/**
 * 관계 조회 옵션
 */
export interface GetRelationsOptions {
  /**
   * 조회 방향 (기본값: 'both')
   */
  direction?: RelationDirection;
  
  /**
   * 관계 유형 필터
   */
  relationTypes?: RelationType[];
  
  /**
   * 최소 신뢰도 임계값
   */
  minConfidence?: number;
  
  /**
   * 최대 결과 수 제한
   */
  limit?: number;
  
  /**
   * 오프셋 (페이지네이션)
   */
  offset?: number;
  
  /**
   * 캐시 우회 여부 (기본값: false)
   * 탐색 중에는 캐시를 우회하고 직접 쿼리하는 것이 더 효율적일 수 있습니다.
   */
  bypassCache?: boolean;
}

/**
 * N-hop 관계 탐색 옵션
 */
export interface GetRelatedMemoriesOptions {
  /**
   * 최대 hop 수 (기본값: 2)
   */
  maxHops?: number;
  
  /**
   * 관계 유형 필터
   */
  relationTypes?: RelationType[];
  
  /**
   * 최소 신뢰도 임계값
   */
  minConfidence?: number;
  
  /**
   * 최대 결과 수 제한
   */
  limit?: number;
  
  /**
   * 순환 참조 포함 여부 (기본값: false)
   */
  includeCyclic?: boolean;
}

/**
 * 관계 추가 옵션
 */
export interface AddRelationOptions {
  /**
   * 신뢰도 (기본값: 0.7)
   */
  confidence?: number;
  
  /**
   * 메타데이터
   */
  metadata?: RelationMetadata;
  
  /**
   * UNIQUE 제약 위반 시 업데이트 여부 (기본값: false)
   */
  updateOnConflict?: boolean;
  
  /**
   * 순환 참조 허용 여부 (기본값: false)
   */
  allowCyclic?: boolean;
}

/**
 * 관계 그래프 인터페이스
 */
export interface IRelationGraph {
  /**
   * 관계 추가
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @param options 추가 옵션
   * @returns 추가된 관계 ID
   * @throws 순환 참조가 감지되고 allowCyclic가 false인 경우
   */
  addRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    options?: AddRelationOptions
  ): Promise<number>;

  /**
   * 관계 조회
   * 
   * @param memoryId 기억 ID
   * @param options 조회 옵션
   * @returns 관계 목록
   */
  getRelations(
    memoryId: string,
    options?: GetRelationsOptions
  ): Promise<MemoryRelation[]>;

  /**
   * 관련 기억 조회 (N-hop 관계 탐색)
   * 
   * @param memoryId 시작 기억 ID
   * @param options 탐색 옵션
   * @returns 관련 기억 ID 목록과 hop 거리
   */
  getRelatedMemories(
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
  }>>;

  /**
   * 관계 삭제
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @returns 삭제 성공 여부
   */
  removeRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<boolean>;

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
  updateConfidence(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    newConfidence: number,
    reason?: string
  ): Promise<boolean>;

  /**
   * 순환 참조 감지
   * 
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @returns 순환 참조 여부
   */
  detectCycle(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<boolean>;
}

/**
 * 관계 타입 레지스트리 항목
 */
export interface RelationTypeRegistry {
  type_name: RelationType;
  category: RelationCategory;
  description: string;
  applicable_types: MemoryType[];
  default_confidence: number;
  search_boost: number;
  created_at: Date;
}
