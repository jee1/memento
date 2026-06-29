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
    const el = e.target.closest('.js-search-result-item');
    if (!el || !el.dataset.memoryId || !state.searchResults || !state.searchResults.items) return;
    const item = state.searchResults.items.find(function (i) { return ns.getSearchItemId(i) === el.dataset.memoryId; });
    if (!item) return;
    if (Array.isArray(state.nodes)) {
      const node = state.nodes.find(function (n) { return n.id === el.dataset.memoryId; });
      if (node) {
        ns.selectNode(node);
        ns.focusOnNode(node, 1.5);
        return;
      }
    }
    ns.displaySearchResultDetails(item);
  }

  function setupEventListeners() {
    document.getElementById('load-map-btn').addEventListener('click', ns.loadMapData);
    document.getElementById('refresh-btn').addEventListener('click', ns.loadMapData);
    document.getElementById('search-btn').addEventListener('click', ns.performSearch);
    document.getElementById('clear-search-btn').addEventListener('click', ns.clearSearch);

    const memDetails = document.getElementById('memory-details');
    if (memDetails) {
      memDetails.addEventListener('click', function (e) {
        const btn = e.target.closest('.js-change-anchor');
        if (btn && btn.dataset.slot) ns.changeAnchor(btn.dataset.slot);
      });
    }

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
  window.changeAnchor = ns.changeAnchor;

})(typeof window !== 'undefined' ? window : globalThis);
