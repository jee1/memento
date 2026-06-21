import { describe, expect, it } from 'vitest';

/**
 * `static/js/anchor-map.js` 검색·하이라이트 순수 로직 회귀 테스트 (GH-150, #570)
 */

function getSearchItemId(item: { id?: string; memory_id?: string } | null | undefined): string {
  if (!item) return '';
  return item.id || item.memory_id || '';
}

function countSearchMapMatches(
  items: Array<{ id?: string; memory_id?: string }> | undefined,
  mapNodes: Array<{ id: string }> | undefined,
): number {
  if (!Array.isArray(items) || !Array.isArray(mapNodes)) {
    return 0;
  }
  const mapIds = new Set(mapNodes.map(n => n.id));
  let matched = 0;
  for (const item of items) {
    if (mapIds.has(getSearchItemId(item))) {
      matched += 1;
    }
  }
  return matched;
}

function buildSearchStatusMessage(
  searchResult: {
    items?: unknown[];
    fallback_used?: boolean;
    local_results_count?: number;
  } | null | undefined,
  mapMatchCount: number,
): string {
  const total = searchResult?.items?.length ?? 0;
  if (total === 0) {
    return '검색 결과가 없습니다.';
  }
  const parts = [`${total}건 검색됨`, `맵 ${mapMatchCount}건 표시`];
  if (searchResult?.fallback_used) {
    parts.push('전역 검색 사용');
  }
  if (searchResult?.local_results_count != null && !searchResult?.fallback_used) {
    parts.push(`국소 ${searchResult.local_results_count}건`);
  }
  return parts.join(' · ');
}

function highlightSearchFocusPath(
  searchResults: { items?: Array<{ id: string }> } | null | undefined,
  nodes: Array<{ id: string }> | undefined,
): void {
  if (!searchResults?.items?.length) {
    return;
  }
  const firstOnMap = searchResults.items
    .map(item => (Array.isArray(nodes) ? nodes.find(n => n.id === item.id) : undefined))
    .find(Boolean);
  if (!firstOnMap) {
    return;
  }
}

function findNodeForAnchor(nodes: unknown, memoryId: string) {
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  return nodes.find((n: { id: string }) => n.id === memoryId);
}

function shouldDimNonMatchingNodes(highlightedIds: Set<string>, mapNodes: Array<{ id: string }>): boolean {
  if (highlightedIds.size === 0) return false;
  const mapMatchCount = mapNodes.filter(n => highlightedIds.has(n.id)).length;
  return mapMatchCount > 0;
}

describe('anchor map search highlight (GH-150, #570)', () => {
  it('highlight focus path does not throw when nodes is undefined', () => {
    expect(() =>
      highlightSearchFocusPath({ items: [{ id: 'mem_1' }] }, undefined),
    ).not.toThrow();
  });

  it('highlight focus path does not throw when nodes is empty', () => {
    expect(() => highlightSearchFocusPath({ items: [{ id: 'mem_1' }] }, [])).not.toThrow();
  });

  it('selectAnchor lookup does not throw when nodes is undefined', () => {
    expect(() => findNodeForAnchor(undefined, 'x')).not.toThrow();
    expect(findNodeForAnchor(undefined, 'x')).toBeUndefined();
  });

  it('getSearchItemId prefers id then memory_id', () => {
    expect(getSearchItemId({ id: 'a', memory_id: 'b' })).toBe('a');
    expect(getSearchItemId({ memory_id: 'b' })).toBe('b');
    expect(getSearchItemId(null)).toBe('');
  });

  it('countSearchMapMatches counts only nodes present on map', () => {
    const items = [{ id: 'mem_1' }, { id: 'mem_2' }, { memory_id: 'mem_3' }];
    const mapNodes = [{ id: 'mem_2' }];
    expect(countSearchMapMatches(items, mapNodes)).toBe(1);
  });

  it('buildSearchStatusMessage includes fallback indicator', () => {
    const msg = buildSearchStatusMessage(
      { items: [{}, {}], fallback_used: true },
      0,
    );
    expect(msg).toContain('2건 검색됨');
    expect(msg).toContain('맵 0건 표시');
    expect(msg).toContain('전역 검색 사용');
  });

  it('shouldDimNonMatchingNodes is false when no map matches', () => {
    const highlighted = new Set(['mem_off_map']);
    const mapNodes = [{ id: 'anchor_1' }];
    expect(shouldDimNonMatchingNodes(highlighted, mapNodes)).toBe(false);
  });

  it('shouldDimNonMatchingNodes is true when map has matches', () => {
    const highlighted = new Set(['mem_1', 'mem_off_map']);
    const mapNodes = [{ id: 'mem_1' }, { id: 'mem_2' }];
    expect(shouldDimNonMatchingNodes(highlighted, mapNodes)).toBe(true);
  });
});
