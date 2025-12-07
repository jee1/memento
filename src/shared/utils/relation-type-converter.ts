/**
 * Relation Type 변환 유틸리티
 * 
 * memory_link 테이블의 relation_type (소문자 스네이크 케이스)와
 * TypeScript RelationType (대문자 스네이크 케이스) 간의 변환을 처리합니다.
 * 
 * Procedural Memory Enhancement (v7.0)
 */

import type { RelationType } from '../types/relation.js';

/**
 * TypeScript RelationType → DB relation_type 변환 매핑
 * 
 * memory_link 테이블은 소문자 스네이크 케이스를 사용하고,
 * TypeScript RelationType은 대문자 스네이크 케이스를 사용합니다.
 */
const TYPE_TO_DB_MAP: Record<RelationType, string> = {
  'VERSION_OF': 'version_of',
  'CAUSES': 'cause_of',
  'DEPENDS_ON': 'derived_from',
  'CONTRASTS_WITH': 'contradicts',
  'FOLLOWS': 'follows', // memory_relation 테이블용 (memory_link에는 없음)
  'REFERENCES': 'references', // memory_relation 테이블용 (memory_link에는 없음)
  'BELONGS_TO': 'belongs_to' // memory_relation 테이블용 (memory_link에는 없음)
};

/**
 * DB relation_type → TypeScript RelationType 변환 매핑
 * 
 * 역방향 매핑을 위한 맵입니다.
 * 'duplicates'는 DB에는 존재하지만 TypeScript enum에 대응값이 없으므로 매핑에서 제외합니다.
 */
const DB_TO_TYPE_MAP: Record<string, RelationType> = {
  'version_of': 'VERSION_OF',
  'cause_of': 'CAUSES',
  'derived_from': 'DEPENDS_ON',
  'contradicts': 'CONTRASTS_WITH',
  // 'duplicates'는 매핑하지 않음 (005 마이그레이션에서 제거됨)
  // memory_relation 테이블용 (memory_link에는 없음)
  'follows': 'FOLLOWS',
  'references': 'REFERENCES',
  'belongs_to': 'BELONGS_TO'
};

/**
 * TypeScript RelationType을 DB relation_type 값으로 변환
 * 
 * @param relationType - TypeScript RelationType (예: 'VERSION_OF')
 * @returns DB relation_type 값 (예: 'version_of')
 * @throws {Error} 매핑되지 않은 RelationType인 경우
 */
export function toDbRelationType(relationType: RelationType): string {
  const dbValue = TYPE_TO_DB_MAP[relationType];
  
  if (!dbValue) {
    throw new Error(`Unmapped RelationType: ${relationType}. Cannot convert to DB value.`);
  }
  
  return dbValue;
}

/**
 * DB relation_type 값을 TypeScript RelationType으로 변환
 * 
 * @param dbValue - DB relation_type 값 (예: 'version_of')
 * @returns TypeScript RelationType (예: 'VERSION_OF') 또는 null (매핑되지 않은 경우)
 * 
 * @remarks
 * 'duplicates'는 DB에는 존재하지만 TypeScript enum에 대응값이 없으므로 null을 반환합니다.
 * 이는 005 마이그레이션에서 제거된 관계 유형입니다.
 */
export function fromDbRelationType(dbValue: string): RelationType | null {
  // 'duplicates'는 매핑하지 않음 (005 마이그레이션에서 제거됨)
  if (dbValue === 'duplicates') {
    return null;
  }
  
  const relationType = DB_TO_TYPE_MAP[dbValue];
  
  // 매핑되지 않은 값인 경우 null 반환
  return relationType || null;
}

/**
 * DB relation_type 값이 유효한지 확인
 * 
 * @param dbValue - 확인할 DB relation_type 값
 * @returns 유효한 경우 true, 그렇지 않으면 false
 */
export function isValidDbRelationType(dbValue: string): boolean {
  // 'duplicates'는 유효하지만 매핑되지 않음
  if (dbValue === 'duplicates') {
    return true;
  }
  
  return dbValue in DB_TO_TYPE_MAP;
}

/**
 * TypeScript RelationType이 memory_link 테이블에서 지원되는지 확인
 * 
 * @param relationType - 확인할 RelationType
 * @returns memory_link에서 지원되는 경우 true, 그렇지 않으면 false
 * 
 * @remarks
 * memory_link 테이블은 다음 relation_type만 지원합니다:
 * - 'version_of' (VERSION_OF)
 * - 'cause_of' (CAUSES)
 * - 'derived_from' (DEPENDS_ON)
 * - 'contradicts' (CONTRASTS_WITH)
 * 
 * memory_relation 테이블은 모든 RelationType을 지원합니다.
 */
export function isMemoryLinkSupported(relationType: RelationType): boolean {
  const supportedTypes: RelationType[] = ['VERSION_OF', 'CAUSES', 'DEPENDS_ON', 'CONTRASTS_WITH'];
  return supportedTypes.includes(relationType);
}

