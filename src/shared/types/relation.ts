/**
 * 관계 추출 엔진 타입 정의
 * 기억 간의 의미적 관계를 추출하고 관리하기 위한 타입들
 */

import type { MemoryItem, MemoryType } from './index.js';

/**
 * 관계 추출 후보
 * 관계 추출 엔진이 발견한 잠재적 관계를 나타냅니다.
 */
export interface RelationCandidate {
  source_id: string; // 소스 기억 ID (새로운 기억)
  target_id: string; // 타겟 기억 ID (기존 기억)
  relation_type: RelationType; // 관계 유형
  confidence: number; // 신뢰도 (0.0~1.0)
  method: 'rule' | 'llm'; // 추출 방법
  evidence?: string; // 추출 근거 (패턴 매칭된 키워드 또는 LLM 설명)
}

/**
 * 관계 유형
 * 관계 추론 엔진에서 지원하는 관계 유형들
 */
export type RelationType =
  | 'CAUSES' // 인과 관계
  | 'DEPENDS_ON' // 의존 관계
  | 'FOLLOWS' // 시간적 순서
  | 'CONTRASTS_WITH' // 대조 관계
  | 'REFERENCES' // 참조 관계
  | 'BELONGS_TO'; // 포함 관계

/**
 * 관계 카테고리
 * 관계 유형을 그룹화하는 카테고리
 */
export type RelationCategory = 'Causal' | 'Temporal' | 'Structural' | 'Semantic';

/**
 * 관계 추출 옵션
 */
export interface ExtractOptions {
  /**
   * 추출 방법 강제 지정 ('rule' | 'llm' | 'hybrid')
   * 기본값: 'hybrid' (규칙 기반 먼저 시도, 실패 시 LLM)
   */
  method?: 'rule' | 'llm' | 'hybrid';

  /**
   * 최소 신뢰도 임계값 (이 값 이상인 관계만 반환)
   * 기본값: 0.5
   */
  minConfidence?: number;

  /**
   * 관계 추출 대상 기억 수 제한
   * 기본값: 50 (규칙 기반), 30 (LLM)
   */
  candidateLimit?: number;

  /**
   * 관계 유형 필터 (특정 관계 유형만 추출)
   */
  relationTypes?: RelationType[];

  /**
   * 즉시 처리 여부 (false인 경우 배치 처리)
   * 기본값: false
   */
  immediate?: boolean;
}

/**
 * 관계 추출 결과
 */
export interface ExtractResult {
  candidates: RelationCandidate[];
  method: 'rule' | 'llm' | 'hybrid';
  processingTime: number; // 처리 시간 (ms)
  candidateCount: number; // 후보 기억 수
  extractedCount: number; // 추출된 관계 수
}

/**
 * 관계 추출기 인터페이스
 * 관계 추출 엔진이 구현해야 하는 인터페이스
 */
export interface IRelationExtractor {
  /**
   * 새로운 기억과 기존 기억들 간의 관계를 추출합니다.
   * 
   * @param newMemory 새로운 기억
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션
   * @returns 관계 후보 목록
   */
  extractRelations(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    options?: ExtractOptions
  ): Promise<RelationCandidate[]>;
}

/**
 * 기억 타입별 적용 가능한 관계 유형 매핑
 */
export const MEMORY_TYPE_RELATION_MAP: Record<MemoryType, RelationType[]> = {
  working: ['REFERENCES'], // 임시적이므로 참조만
  episodic: ['CAUSES', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'],
  semantic: ['DEPENDS_ON', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'],
  procedural: ['DEPENDS_ON', 'FOLLOWS', 'REFERENCES']
};

/**
 * 관계 유형별 카테고리 매핑
 */
export const RELATION_TYPE_CATEGORY_MAP: Record<RelationType, RelationCategory> = {
  CAUSES: 'Causal',
  DEPENDS_ON: 'Structural',
  FOLLOWS: 'Temporal',
  CONTRASTS_WITH: 'Semantic',
  REFERENCES: 'Semantic',
  BELONGS_TO: 'Structural'
};

/**
 * 관계 유형별 검색 부스트 가중치 (기본값)
 * 실제 값은 relation_type_registry 테이블에서 관리
 */
export const RELATION_TYPE_BOOST_MAP: Record<RelationType, number> = {
  CAUSES: 1.2,
  DEPENDS_ON: 1.1,
  FOLLOWS: 1.0,
  CONTRASTS_WITH: 0.9,
  REFERENCES: 0.8,
  BELONGS_TO: 1.0
};

/**
 * 기억 타입에 적용 가능한 관계 유형인지 확인
 */
export function isApplicableRelationType(
  memoryType: MemoryType,
  relationType: RelationType
): boolean {
  return MEMORY_TYPE_RELATION_MAP[memoryType].includes(relationType);
}

/**
 * 관계 유형의 카테고리를 반환
 */
export function getRelationCategory(relationType: RelationType): RelationCategory {
  return RELATION_TYPE_CATEGORY_MAP[relationType];
}

/**
 * 관계 유형의 검색 부스트 가중치를 반환
 */
export function getRelationBoost(relationType: RelationType): number {
  return RELATION_TYPE_BOOST_MAP[relationType];
}

/**
 * 모든 관계 유형 목록
 * 여러 파일에서 중복 정의를 방지하기 위한 공통 상수
 */
export const ALL_RELATION_TYPES: readonly RelationType[] = [
  'CAUSES',
  'DEPENDS_ON',
  'FOLLOWS',
  'CONTRASTS_WITH',
  'REFERENCES',
  'BELONGS_TO'
] as const;
