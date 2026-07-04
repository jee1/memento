/**
 * Memory Graph — search highlight (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_GRAPH__;
  if (!ns) {
    return;
  }

  const state = ns.state;

  function normalizeSearchText(value) {
    return String(value ?? '').trim().toLocaleLowerCase('ko-KR');
  }

  function getSearchHaystack(node) {
    return [
      node.content,
      node.summary,
      node.label,
      ...(Array.isArray(node.tags) ? node.tags : []),
    ]
      .map((value) => String(value ?? ''))
      .join(' ')
      .toLocaleLowerCase('ko-KR');
  }

  function getNodeId(edgeEndpoint) {
    return typeof edgeEndpoint === 'object' && edgeEndpoint !== null ? edgeEndpoint.id : edgeEndpoint;
  }

  function collectMatchingIds(nodes, query) {
    const matchingIds = new Set();
    for (const node of nodes) {
      if (getSearchHaystack(node).includes(query)) {
        matchingIds.add(node.id);
      }
    }
    return matchingIds;
  }

  function setMatchBadge(count, total) {
    const { matchBadge } = ns.dom;
    if (!state.activeSearchQuery) {
      matchBadge.style.display = 'none';
      matchBadge.textContent = '';
      return;
    }
    matchBadge.textContent = `${count}개 노드 매칭`;
    matchBadge.style.display = 'inline-block';
    if (total > 0 && count === 0) {
      matchBadge.textContent = '0개 노드 매칭';
    }
  }

  function applyNodeHighlight(matchingIds, hasQuery) {
    if (!state.renderedNodeSelection) {
      return;
    }
    state.renderedNodeSelection
      .classed('search-match', (d) => hasQuery && matchingIds.has(d.id))
      .classed('search-dim', (d) => hasQuery && !matchingIds.has(d.id));

    state.renderedNodeSelection.select('circle').attr('r', (d) => {
      const radius = d.__graphRadius ?? 8;
      return hasQuery && matchingIds.has(d.id) ? radius * 1.25 : radius;
    });
  }

  function applyLinkHighlight(matchingIds, hasQuery) {
    if (!state.renderedLinkSelection) {
      return;
    }
    state.renderedLinkSelection.classed('search-dim', (d) => {
      if (!hasQuery) {
        return false;
      }
      return !matchingIds.has(getNodeId(d.source)) && !matchingIds.has(getNodeId(d.target));
    });
  }

  ns.applySearchHighlight = function applySearchHighlight() {
    const nodes = Array.isArray(state.lastGraphNodes) ? state.lastGraphNodes : [];
    const query = normalizeSearchText(state.activeSearchQuery);
    const hasQuery = query.length > 0;
    const matchingIds = hasQuery ? collectMatchingIds(nodes, query) : new Set();

    setMatchBadge(matchingIds.size, nodes.length);
    applyNodeHighlight(matchingIds, hasQuery);
    applyLinkHighlight(matchingIds, hasQuery);
  };

  ns.applySearchFromInput = function applySearchFromInput() {
    state.activeSearchQuery = ns.dom.searchInput.value;
    ns.applySearchHighlight();
  };
})(typeof window !== 'undefined' ? window : globalThis);
