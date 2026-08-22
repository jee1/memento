/**
 * 타입 가드 유틸리티
 * 데이터베이스 조회 결과의 타입 안전성을 보장하기 위한 타입 가드 함수들
 */

import type {
  MemoryItem,
  MemoryType,
  MemoryTypeRequest,
  PrivacyScope,
  SqlParam,
} from '../types/memory.types.js';

/** memory_item 하이브리드 검색에 쓰이는 네 타입 */
export const MEMORY_ITEM_TYPES: readonly MemoryType[] = [
  'working',
  'episodic',
  'semantic',
  'procedural',
];

/**
 * 데이터베이스에서 조회한 메모리 행 타입
 */
export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  created_at: string;
  updated_at?: string;
  last_accessed?: string;
  pinned?: number | boolean;
  tags?: string | null;
  source?: string | null;
  embedding?: string | null; // JSON 배열 문자열
}

/**
 * 타입 가드: MemoryRow인지 확인
 * 
 * @param value 확인할 값
 * @returns MemoryRow 여부
 */
export function isMemoryRow(value: unknown): value is MemoryRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.type === 'string' &&
    typeof row.content === 'string' &&
    typeof row.importance === 'number' &&
    typeof row.privacy_scope === 'string' &&
    typeof row.created_at === 'string'
  );
}

/**
 * 타입 가드: MemoryType인지 확인
 * 
 * @param value 확인할 값
 * @returns MemoryType 여부
 */
export function isMemoryType(value: string): value is MemoryType {
  return value === 'working' || value === 'episodic' || value === 'semantic' || value === 'procedural';
}

/** core/vault 요청 타입을 제외한 memory_item 타입인지 확인 */
export function isMemoryItemType(type: MemoryTypeRequest): type is MemoryType {
  return isMemoryType(type);
}

/** 네 memory_item 타입을 모두 포함하는지 확인 */
export function isFullMemoryItemTypeSet(types: readonly MemoryType[]): boolean {
  if (types.length !== MEMORY_ITEM_TYPES.length) {
    return false;
  }
  const set = new Set(types);
  return MEMORY_ITEM_TYPES.every(type => set.has(type));
}

/**
 * 타입 가드: PrivacyScope인지 확인
 * 
 * @param value 확인할 값
 * @returns PrivacyScope 여부
 */
export function isPrivacyScope(value: string): value is PrivacyScope {
  return value === 'private' || value === 'team' || value === 'public';
}

/**
 * MemoryRow를 MemoryItem으로 변환
 * 타입 안전성을 보장하며 변환합니다.
 * 
 * @param row 데이터베이스 행
 * @returns MemoryItem 또는 null (타입 검증 실패 시)
 */
export function convertMemoryRowToItem(row: MemoryRow): MemoryItem | null {
  // 타입 검증
  if (!isMemoryType(row.type)) {
    return null;
  }
  if (!isPrivacyScope(row.privacy_scope)) {
    return null;
  }

  // embedding 파싱 (JSON 배열 문자열인 경우)
  let embedding: number[] | undefined;
  if (row.embedding) {
    try {
      const parsed = JSON.parse(row.embedding);
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'number')) {
        embedding = parsed;
      }
    } catch {
      // 파싱 실패 시 무시
    }
  }

  // tags 파싱 (JSON 배열 문자열인 경우)
  let tags: string[] | undefined;
  if (row.tags) {
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
        tags = parsed;
      }
    } catch {
      // 파싱 실패 시 무시
    }
  }

  return {
    id: row.id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    privacy_scope: row.privacy_scope,
    created_at: new Date(row.created_at),
    last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
    pinned: typeof row.pinned === 'boolean' ? row.pinned : Boolean(row.pinned),
    tags,
    source: row.source || undefined,
    embedding
  };
}

/**
 * 관계 행 타입
 */
export interface RelationRow {
  id: number;
  source_id: string;
  target_id: string;
  relation_type: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

/**
 * 타입 가드: RelationRow인지 확인
 * 
 * @param value 확인할 값
 * @returns RelationRow 여부
 */
export function isRelationRow(value: unknown): value is RelationRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'number' &&
    typeof row.source_id === 'string' &&
    typeof row.target_id === 'string' &&
    typeof row.relation_type === 'string' &&
    typeof row.confidence === 'number' &&
    typeof row.created_at === 'string' &&
    typeof row.updated_at === 'string' &&
    (row.metadata === null || typeof row.metadata === 'string')
  );
}

/**
 * 기존 관계 행 타입
 */
export interface ExistingRelationRow {
  id: number;
  confidence: number;
  metadata: string | null;
}

/**
 * 타입 가드: ExistingRelationRow인지 확인
 * 
 * @param value 확인할 값
 * @returns ExistingRelationRow 여부
 */
export function isExistingRelationRow(value: unknown): value is ExistingRelationRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'number' &&
    typeof row.confidence === 'number' &&
    (row.metadata === null || typeof row.metadata === 'string')
  );
}

/**
 * 메타데이터 행 타입
 */
export interface MetadataRow {
  metadata: string | null;
}

/**
 * 타입 가드: MetadataRow인지 확인
 * 
 * @param value 확인할 값
 * @returns MetadataRow 여부
 */
export function isMetadataRow(value: unknown): value is MetadataRow {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return row.metadata === null || typeof row.metadata === 'string';
}

/**
 * 타입 가드: SqlParam인지 확인
 * SQLite에서 지원하는 파라미터 타입인지 검증합니다.
 * 
 * @param value 확인할 값
 * @returns SqlParam 여부
 */
export function isSqlParam(value: unknown): value is SqlParam {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value instanceof Date
  );
}
