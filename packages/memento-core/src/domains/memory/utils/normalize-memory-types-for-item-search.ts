import { isMemoryItemType, type MemoryType, type MemoryTypeRequest } from '../../../shared/types/index.js';

/**
 * memory_injection / knowledge context 공통: core·vault 제거 후 memory_item 검색용 타입만 남긴다.
 * `undefined`·빈 배열 → `undefined` (하이브리드 type 필터 생략).
 */
export function normalizeMemoryTypesForHybridItemSearch(
  types: readonly MemoryTypeRequest[] | undefined | null,
): MemoryType[] | undefined {
  if (types == null || types.length === 0) {
    return undefined;
  }
  const stripped = types.filter((t) => t !== 'core' && t !== 'vault');
  const valid = stripped.filter(isMemoryItemType);
  if (valid.length === 0) {
    throw new Error(
      "memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다.",
    );
  }
  return valid;
}
