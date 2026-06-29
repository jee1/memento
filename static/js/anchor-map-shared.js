/**
 * Anchor Map — shared state, utilities, and DOM helpers.
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_ANCHOR_MAP__ = global.__MEMENTO_ANCHOR_MAP__ || {});

  // Mutable rendering state — every assignment must write back via ns.state.*
  ns.state = ns.state || {
    svg: null,
    simulation: null,
    zoomBehavior: null,
    nodes: [],
    links: [],
    mapData: null,
    searchResults: null,
    highlightedNodeIds: new Set(),
    autoRefreshInterval: null,
    websocket: null,
  };

  // CSS token definitions for anchor slots
  ns.slotColorTokens = {
    A: { fill: '--color-anchor-a', stroke: '--color-anchor-a-stroke' },
    B: { fill: '--color-anchor-b', stroke: '--color-anchor-b-stroke' },
    C: { fill: '--color-anchor-c', stroke: '--color-anchor-c-stroke' },
  };

  ns.readAnchorMapToken = function readAnchorMapToken(name, fallback = '') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) return value;
    if (fallback) return fallback;
    throw new Error(`Missing CSS token: ${name}`);
  };

  ns.getAnchorMapPalette = function getAnchorMapPalette() {
    return {
      slotColors: Object.fromEntries(
        Object.entries(ns.slotColorTokens).map(function ([slot, tokenNames]) {
          return [slot, {
            fill: ns.readAnchorMapToken(tokenNames.fill),
            stroke: ns.readAnchorMapToken(tokenNames.stroke),
          }];
        })
      ),
      memoryFill: ns.readAnchorMapToken('--color-memory-neutral'),
      memoryStroke: ns.readAnchorMapToken('--color-memory-neutral-stroke'),
      labelFill: ns.readAnchorMapToken('--color-text-main'),
    };
  };

  /** XSS: escape HTML special chars */
  ns.escapeHtml = function escapeHtml(str) {
    if (str == null) return '';
    const s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  ns.getSearchItemId = function getSearchItemId(item) {
    if (!item) return '';
    return item.id || item.memory_id || '';
  };

  ns.countSearchMapMatches = function countSearchMapMatches(items, mapNodes) {
    if (!Array.isArray(items) || !Array.isArray(mapNodes)) return 0;
    const mapIds = new Set(mapNodes.map(function (n) { return n.id; }));
    let matched = 0;
    for (const item of items) {
      if (mapIds.has(ns.getSearchItemId(item))) matched += 1;
    }
    return matched;
  };

  ns.buildSearchStatusMessage = function buildSearchStatusMessage(searchResult, mapMatchCount) {
    const total = (searchResult && searchResult.items && searchResult.items.length) || 0;
    if (total === 0) return '검색 결과가 없습니다.';
    const parts = [total + '건 검색됨', '맵 ' + mapMatchCount + '건 표시'];
    if (searchResult.fallback_used) parts.push('전역 검색 사용');
    if (searchResult.local_results_count != null && !searchResult.fallback_used) {
      parts.push('국소 ' + searchResult.local_results_count + '건');
    }
    return parts.join(' · ');
  };

  ns.normalizeMapData = function normalizeMapData(data) {
    return {
      ...(data || {}),
      anchors: Array.isArray(data && data.anchors) ? data.anchors : [],
      nodes: Array.isArray(data && data.nodes) ? data.nodes : [],
      links: Array.isArray(data && data.links) ? data.links : [],
      timestamp: (data && data.timestamp) || new Date().toISOString(),
    };
  };

  ns.normalizeSearchResults = function normalizeSearchResults(payload) {
    const candidate = (payload && payload.result) || payload || {};
    return {
      ...candidate,
      items: Array.isArray(candidate.items) ? candidate.items : [],
    };
  };

  ns.getLinkNodeId = function getLinkNodeId(value) {
    return value && typeof value === 'object' ? value.id : value;
  };

  ns.debugAnchorMap = function debugAnchorMap(eventName, detail) {
    if (window.localStorage.getItem('memento.debug') !== '1') return;
    document.dispatchEvent(new CustomEvent('memento:debug', {
      bubbles: true,
      composed: true,
      detail: { scope: 'anchor-map', eventName, detail },
    }));
  };

  ns.updateSearchStatus = function updateSearchStatus(message, isActive) {
    const statusEl = document.getElementById('anchor-search-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('is-active', Boolean(isActive));
    statusEl.classList.toggle('no-data', !isActive);
  };

})(typeof window !== 'undefined' ? window : globalThis);
