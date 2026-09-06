/**
 * Anchor Map — search, highlight, and results panel.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_ANCHOR_MAP__;
  if (!ns) return;

  const escapeHtml = ns.escapeHtml;
  const state = ns.state;

  function renderSearchResultsList() {
    const container = document.getElementById('anchor-search-results');
    if (!container) return;

    if (!state.searchResults || !state.searchResults.items || !state.searchResults.items.length) {
      container.innerHTML = '<p class="no-data">No search results</p>';
      return;
    }

    const mapIds = new Set(Array.isArray(state.nodes) ? state.nodes.map(function (n) { return n.id; }) : []);
    container.innerHTML = state.searchResults.items
      .map(function (item, index) {
        const id = ns.getSearchItemId(item);
        if (!id) return '';
        const onMap = mapIds.has(id);
        const preview = escapeHtml((item.content || '').substring(0, 80));
        const suffix = item.content && item.content.length > 80 ? '...' : '';
        const similarity = item.similarity != null
          ? escapeHtml((item.similarity * 100).toFixed(1) + '%')
          : 'N/A';
        const titleText = onMap ? '맵에 표시됨 — 클릭하여 포커스' : '맵 밖 결과 — 클릭하여 상세 보기';
        return '<div class="anchor-search-result-item' + (onMap ? ' is-on-map' : '') + ' js-search-result-item"' +
          ' data-memory-id="' + escapeHtml(id) + '"' +
          ' title="' + escapeHtml(titleText) + '">' +
          '<div class="search-result-meta">#' + (index + 1) + ' · ' + escapeHtml(id) + ' · ' + similarity + '</div>' +
          '<div class="search-result-preview">' + preview + suffix + '</div>' +
          '</div>';
      })
      .join('');
  }

  function updateNodeHighlight() {
    if (!state.svg) return;
    const nodeElements = state.svg.selectAll('.node');
    const mapMatchCount = Array.isArray(state.nodes)
      ? state.nodes.filter(function (n) { return state.highlightedNodeIds.has(n.id); }).length
      : 0;
    const shouldDimOthers = state.highlightedNodeIds.size > 0 && mapMatchCount > 0;

    nodeElements
      .classed('highlighted', function (d) { return state.highlightedNodeIds.has(d.id); })
      .attr('stroke-width', function (d) {
        if (state.highlightedNodeIds.has(d.id)) return d.type === 'anchor' ? 5 : 4;
        return d.type === 'anchor' ? 3 : 2;
      })
      .attr('opacity', function (d) {
        if (shouldDimOthers && !state.highlightedNodeIds.has(d.id)) return 0.3;
        return d.embedding_missing ? 0.6 : 1.0;
      });

    const linkElements = state.svg.selectAll('.link');
    linkElements
      .attr('opacity', function (d) {
        if (!shouldDimOthers) return 0.6;
        const sourceHighlighted = state.highlightedNodeIds.has(ns.getLinkNodeId(d.source));
        const targetHighlighted = state.highlightedNodeIds.has(ns.getLinkNodeId(d.target));
        return (sourceHighlighted || targetHighlighted) ? 1.0 : 0.2;
      })
      .attr('stroke-width', function (d) {
        if (state.highlightedNodeIds.size === 0) return d.type === 'hop' ? 2 : 1.5;
        const sh = state.highlightedNodeIds.has(ns.getLinkNodeId(d.source));
        const th = state.highlightedNodeIds.has(ns.getLinkNodeId(d.target));
        if (sh && th) return 3;
        if (sh || th) return 2;
        return d.type === 'hop' ? 2 : 1.5;
      });

    const labelElements = state.svg.selectAll('.node-label');
    labelElements
      .style('font-weight', function (d) { return state.highlightedNodeIds.has(d.id) ? 'bold' : 'normal'; })
      .style('font-size', function (d) { return state.highlightedNodeIds.has(d.id) ? '14px' : '12px'; });
  }

  function highlightSearchResults(options) {
    const autoFocus = !options || options.autoFocus !== false;
    if (!state.searchResults || !state.searchResults.items) {
      ns.updateSearchStatus('검색 결과가 없습니다.', false);
      renderSearchResultsList();
      return;
    }

    state.highlightedNodeIds.clear();
    state.searchResults.items.forEach(function (item) {
      const id = ns.getSearchItemId(item);
      if (id) state.highlightedNodeIds.add(id);
    });

    updateNodeHighlight();

    const mapMatchCount = ns.countSearchMapMatches(state.searchResults.items, state.nodes);
    ns.updateSearchStatus(ns.buildSearchStatusMessage(state.searchResults, mapMatchCount), true);
    renderSearchResultsList();

    if (autoFocus && state.searchResults.items.length > 0 && Array.isArray(state.nodes)) {
      const firstOnMap = state.searchResults.items.find(function (item) {
        return state.nodes.some(function (n) { return n.id === ns.getSearchItemId(item); });
      });
      if (firstOnMap) ns.focusSearchResult(firstOnMap);
    }
  }

  /**
   * 검색 결과 하나를 맵에서 선택하고 상세를 연다.
   * 상세는 반드시 검색 항목 기준으로 그린다 — 맵 노드의 similarity 는 앵커 기준이라
   * 목록에 찍힌 쿼리 유사도와 다른 숫자가 나온다 (issue 871).
   */
  function focusSearchResult(item) {
    ns.displaySearchResultDetails(item);
    const id = ns.getSearchItemId(item);
    const node = Array.isArray(state.nodes)
      ? state.nodes.find(function (n) { return n.id === id; })
      : undefined;
    if (!node) return;
    ns.markNodeSelected(id);
    ns.focusOnNode(node, 1.5);
  }

  async function performSearch() {
    const queryEl = document.getElementById('search-query-input');
    const slotSelect = document.getElementById('search-slot-select');
    const query = queryEl ? queryEl.value.trim() : '';
    const slot = slotSelect ? slotSelect.value : 'A';
    const agentId = ns.getSelectedAgentId();

    if (!query) {
      alert('검색어를 입력해주세요.');
      return;
    }
    if (!slot || !['A', 'B', 'C'].includes(slot)) {
      alert('슬롯을 선택해주세요. (A, B, C 중 하나)');
      return;
    }

    try {
      ns.updateSearchStatus('검색 중...', false);
      const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
      const response = await fetchFn('/api/anchors/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, slot, agent_id: agentId, limit: 100 }),
      });
      if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

      state.searchResults = ns.normalizeSearchResults(await response.json());
      highlightSearchResults();

      const resultCount = state.searchResults.items ? state.searchResults.items.length : 0;
      ns.debugAnchorMap('search-complete', { resultCount });
    } catch (error) {
      ns.updateSearchStatus('검색 실패: ' + error.message, false);
      ns.debugAnchorMap('search-error', { message: error.message });
      alert('검색 중 오류가 발생했습니다: ' + error.message);
    }
  }

  function clearSearch() {
    state.searchResults = null;
    state.highlightedNodeIds.clear();
    const queryEl = document.getElementById('search-query-input');
    const slotSelect = document.getElementById('search-slot-select');
    if (queryEl) queryEl.value = '';
    if (slotSelect) slotSelect.value = 'A';

    ns.updateSearchStatus('검색 후 결과가 여기에 표시됩니다.', false);
    renderSearchResultsList();
    updateNodeHighlight();
    ns.debugAnchorMap('search-cleared');
  }

  function displaySearchResultDetails(item) {
    ns.displayMemoryDetails({
      id: ns.getSearchItemId(item),
      type: 'memory',
      content: item.content || '',
      hop_distance: item.hop_distance,
      similarity: item.similarity,
      importance: item.importance,
      created_at: item.created_at,
    });
  }

  ns.performSearch = performSearch;
  ns.clearSearch = clearSearch;
  ns.highlightSearchResults = highlightSearchResults;
  ns.focusSearchResult = focusSearchResult;
  ns.updateNodeHighlight = updateNodeHighlight;
  ns.renderSearchResultsList = renderSearchResultsList;
  ns.displaySearchResultDetails = displaySearchResultDetails;

})(typeof window !== 'undefined' ? window : globalThis);
