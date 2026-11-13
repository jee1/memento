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
    searchResultsExpanded: false,
    highlightedNodeIds: new Set(),
    autoRefreshInterval: null,
    websocket: null,
    mapStatusKey: null,   // 마지막으로 표시한 (kind, message) — 같은 실패의 반복 렌더를 막는다 (issue 904)
    layoutMode: 'auto',            // 'auto' | 'paused'
    layoutPersistDisabled: false,  // localStorage write failure → session persist off
    redrawTick: null,              // runSimulation tick fn (manual redraw while paused)
    activeDragCount: 0,            // 진행 중인 d3 drag gesture 수 (>0 이면 재렌더 지연) (issue 948)
    pendingRefreshRender: false,   // 드래그 중 도착한 갱신 — dragended 에서 한 번만 반영 (issue 948)
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

  // Slot tie-break order for equal hop_distance (issue 1692).
  ns.ANCHOR_SLOT_ORDER = { A: 0, B: 1, C: 2 };

  /** Hop → fill-opacity. Farther memberships read lighter; keep separate from embedding_missing opacity. */
  ns.hopFillOpacity = function hopFillOpacity(hopDistance) {
    const hop = Number(hopDistance);
    if (!Number.isFinite(hop) || hop <= 1) return 1;
    if (hop === 2) return 0.75;
    return 0.55;
  };

  /**
   * Rank memberships: nearer hop first, then slot A → B → C.
   * @param {Array<{slot: string, hop_distance: number}>|null|undefined} anchors
   * @returns {Array<{slot: string, hop_distance: number}>}
   */
  ns.rankAnchorMemberships = function rankAnchorMemberships(anchors) {
    if (!Array.isArray(anchors) || anchors.length === 0) return [];
    return anchors.slice().sort(function (left, right) {
      const hopDelta = (Number(left.hop_distance) || 0) - (Number(right.hop_distance) || 0);
      if (hopDelta !== 0) return hopDelta;
      const leftOrder = ns.ANCHOR_SLOT_ORDER[left.slot];
      const rightOrder = ns.ANCHOR_SLOT_ORDER[right.slot];
      return (leftOrder == null ? 9 : leftOrder) - (rightOrder == null ? 9 : rightOrder);
    });
  };

  /**
   * Paint rule for memory nodes (issue 1692).
   * Fill = closest membership slot (tie A/B/C). fillOpacity from that hop.
   * Stroke = second membership when present, else that slot stroke / neutral.
   * @returns {{fill: string, stroke: string, fillOpacity: number, primarySlot: string|null, membershipLabel: string}}
   */
  ns.resolveMemoryNodePaint = function resolveMemoryNodePaint(anchors, palette) {
    const ranked = ns.rankAnchorMemberships(anchors);
    if (ranked.length === 0) {
      return {
        fill: palette.memoryFill,
        stroke: palette.memoryStroke,
        fillOpacity: 1,
        primarySlot: null,
        membershipLabel: '',
      };
    }
    const primary = ranked[0];
    const secondary = ranked[1];
    const primaryColors = palette.slotColors[primary.slot];
    const secondaryColors = secondary ? palette.slotColors[secondary.slot] : null;
    return {
      fill: primaryColors ? primaryColors.fill : palette.memoryFill,
      stroke: secondaryColors
        ? secondaryColors.stroke
        : (primaryColors ? primaryColors.stroke : palette.memoryStroke),
      fillOpacity: ns.hopFillOpacity(primary.hop_distance),
      primarySlot: primary.slot || null,
      membershipLabel: ranked
        .map(function (entry) { return entry.slot + '(' + entry.hop_distance + '-hop)'; })
        .join(', '),
    };
  };

  /** Keep legend copy aligned with paint rules without waiting on a map payload. */
  ns.applyMapLegendCopy = function applyMapLegendCopy() {
    const root = document.querySelector('.map-legend');
    if (!root) return;
    const items = root.querySelectorAll('.legend-item');
    const copies = [
      { title: '슬롯 A 앵커와 그 기억 — 검색 범위 A=1-hop', text: '슬롯 A 앵커와 그 기억' },
      { title: '슬롯 B 앵커와 그 기억 — 검색 범위 B=2-hop', text: '슬롯 B 앵커와 그 기억' },
      { title: '슬롯 C 앵커와 그 기억 — 검색 범위 C=3-hop', text: '슬롯 C 앵커와 그 기억' },
      { title: '어느 앵커에도 속하지 않는 기억 노드', text: '앵커 없는 기억(회색)' },
    ];
    for (let i = 0; i < items.length && i < copies.length; i += 1) {
      items[i].setAttribute('title', copies[i].title);
      const label = items[i].querySelector('span:not(.legend-color)');
      if (label) label.textContent = copies[i].text;
    }
    let note = root.querySelector('.legend-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'legend-note';
      root.appendChild(note);
    }
    note.textContent = '옅을수록 앵커에서 멀다. 테두리가 다른 색이면 그 앵커에도 속한다.';
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

  // normalizeMapData 는 누락 필드를 [] 로 보정한다 — 그래서 형태가 깨진 데이터도 "빈 맵"처럼 보인다.
  // ingestion 시점에는 보정 전에 이걸로 걸러 빈 상태와 오류 상태를 구분한다 (issue 949).
  ns.isMapDataShapeValid = function isMapDataShapeValid(data) {
    return Boolean(data) && typeof data === 'object' && Array.isArray(data.nodes);
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
    statusEl.classList.toggle('m-empty', !isActive);
  };

})(typeof window !== 'undefined' ? window : globalThis);
