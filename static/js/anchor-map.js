/**
 * Anchor Map — initialization, event wiring, and public API.
 * Depends on: anchor-map-shared.js, anchor-map-render.js, anchor-map-search.js,
 *             anchor-map-data.js, anchor-map-ws.js (loaded before this file).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_ANCHOR_MAP__;
  if (!ns) return;

  const state = ns.state;

  function initializeMap() {
    if (typeof d3 === 'undefined') {
      const fallbackContainer = document.getElementById('anchor-map');
      if (fallbackContainer) {
        fallbackContainer.innerHTML = '<p class="no-data">Anchor Map renderer is unavailable.</p>';
      }
      ns.debugAnchorMap('d3-unavailable');
      return;
    }

    const container = d3.select('#anchor-map');
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    state.svg = container.append('svg').attr('width', width).attr('height', height);

    state.zoomBehavior = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', function (event) { state.svg.select('g').attr('transform', event.transform); });

    state.svg.call(state.zoomBehavior);
    state.svg.append('g');

    state.simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(function (d) { return d.id; }).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      // ponytail: mild centering keeps freed nodes on canvas (off-canvas 71 -> 10 at 122 nodes);
      // replace with zoom-to-fit (issue 874) when that lands.
      .force('x', d3.forceX(width / 2).strength(0.15))
      .force('y', d3.forceY(height / 2).strength(0.15))
      .force('collision', d3.forceCollide().radius(30));

    window.addEventListener('resize', function () {
      const newWidth = container.node().getBoundingClientRect().width;
      const newHeight = container.node().getBoundingClientRect().height;
      state.svg.attr('width', newWidth).attr('height', newHeight);
      state.simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
      state.simulation.alpha(1).restart();
    });
  }

  function onSearchResultClick(e) {
    if (e.target.closest('.js-search-result-more')) {
      ns.expandSearchResults();
      return;
    }
    const el = e.target.closest('.js-search-result-item');
    if (!el || !el.dataset.memoryId || !state.searchResults || !state.searchResults.items) return;
    const item = state.searchResults.items.find(function (i) { return ns.getSearchItemId(i) === el.dataset.memoryId; });
    if (!item) return;
    // 맵에 있든 없든 상세는 검색 항목 기준으로 그린다 (issue 871). 맵에 있으면 포커스도 이동한다.
    ns.focusSearchResult(item);
  }

  function setupEventListeners() {
    // Load Map 은 Refresh 와 동일한 핸들러였다 — 버튼 하나로 합쳤다 (issue 874)
    document.getElementById('refresh-btn').addEventListener('click', ns.loadMapData);
    document.getElementById('fit-btn').addEventListener('click', ns.fitToNodes);
    document.getElementById('search-btn').addEventListener('click', ns.performSearch);
    document.getElementById('clear-search-btn').addEventListener('click', ns.clearSearch);

    const anchorList = document.getElementById('anchor-list');
    if (anchorList) {
      anchorList.addEventListener('click', function (e) {
        const el = e.target.closest('.js-select-anchor');
        if (el && el.dataset.memoryId) ns.selectAnchorNode(el.dataset.memoryId);
      });
    }

    const searchResults = document.getElementById('anchor-search-results');
    if (searchResults) searchResults.addEventListener('click', onSearchResultClick);

    document.getElementById('auto-refresh-toggle').addEventListener('change', function (e) {
      if (e.target.checked) ns.startAutoRefresh();
      else ns.stopAutoRefresh();
    });

    document.getElementById('refresh-interval-select').addEventListener('change', function () {
      if (document.getElementById('auto-refresh-toggle').checked) {
        ns.stopAutoRefresh();
        ns.startAutoRefresh();
      }
    });

    document.getElementById('agent-id-select').addEventListener('change', function () {
      ns.loadMapData();
      ns.resubscribeWebSocket();
    });

    document.getElementById('search-query-input').addEventListener('keypress', function (e) {
      if (e.key === 'Enter') ns.performSearch();
    });

    ns.tryConnectWebSocket();
  }

  document.addEventListener('DOMContentLoaded', async function () {
    initializeMap();
    setupEventListeners();
    await ns.loadAgentIdOptions();
    ns.loadMapData();
  });

  window.addEventListener('beforeunload', function () {
    ns.stopAutoRefresh();
    ns.disconnectWebSocket();
  });

  // Public API
  window.selectAnchorNode = ns.selectAnchorNode;
  window.fitAnchorMap = ns.fitToNodes;

})(typeof window !== 'undefined' ? window : globalThis);
