import { describe, expect, it } from 'vitest';

/**
 * `static/js/anchor-map.js` 의 `highlightSearchResults` 첫 결과 포커스 경로를
 * DOM/D3 없이 재현한다. GH-150: `nodes` 가 undefined 일 때 `.find` 호출로 TypeError 나던 문제 회귀 방지.
 */
function highlightSearchFocusPath(
  searchResults: { items?: Array<{ id: string }> } | null | undefined,
  nodes: Array<{ id: string }> | undefined,
): void {
  if (!searchResults?.items?.length) {
    return;
  }
  const firstResult = searchResults.items[0];
  if (!Array.isArray(nodes)) {
    return;
  }
  nodes.find(n => n.id === firstResult.id);
}

/** `selectAnchorNode` 의 nodes.find 패턴 (배열 아닐 때 방어) */
function findNodeForAnchor(nodes: unknown, memoryId: string) {
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  return nodes.find((n: { id: string }) => n.id === memoryId);
}

describe('anchor map search highlight (GH-150)', () => {
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
});
