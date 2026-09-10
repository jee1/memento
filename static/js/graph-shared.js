/**
 * Memory Graph — shared state, palette, DOM refs, status helpers (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_GRAPH__ = global.__MEMENTO_GRAPH__ || {});

  ns.state = ns.state || {
    simulation: null,
    lastGraphNodes: null,
    lastGraphEdges: null,
    rawGraphNodes: null,
    rawGraphEdges: null,
    resizeRedrawTimer: null,
    lastGraphMeta: null,
    activeSearchQuery: '',
    renderedNodeSelection: null,
    renderedLinkSelection: null,
  };

  ns.readGraphToken = function readGraphToken(name, fallback = '') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) {
      return value;
    }
    if (fallback) {
      return fallback;
    }
    throw new Error(`Missing CSS token: ${name}`);
  };

  ns.getGraphPalette = function getGraphPalette() {
    const readGraphToken = ns.readGraphToken;
    return {
      nodeColors: {
        episodic: readGraphToken('--color-memory-episodic'),
        semantic: readGraphToken('--color-memory-semantic'),
        procedural: readGraphToken('--color-memory-procedural'),
        working: readGraphToken('--color-memory-working'),
        default: readGraphToken('--color-memory-neutral'),
      },
      edgeColors: {
        supports: readGraphToken('--color-memory-episodic'),
        related_to: readGraphToken('--color-memory-semantic'),
        extracted_from: readGraphToken('--color-memory-procedural'),
        contradicts: readGraphToken('--color-error'),
        default: readGraphToken('--color-graph-edge-default'),
      },
    };
  };

  ns.getNodeFillColor = function getNodeFillColor(type, palette) {
    return palette.nodeColors[type] ?? palette.nodeColors.default;
  };

  ns.getNodeStrokeColor = function getNodeStrokeColor(type, palette) {
    const fill = ns.getNodeFillColor(type, palette);
    const color = d3.color(fill);
    return color ? color.darker(0.5).formatHex() : fill;
  };

  ns.escHtml = function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  ns.getEdgeNodeId = function getEdgeNodeId(endpoint) {
    return typeof endpoint === 'object' && endpoint !== null ? endpoint.id : endpoint;
  };

  /**
   * View orphan (issue 835) 필터 — 현재 응답 엣지에서 degree=0 인 노드를 제외한다.
   * DB orphan(memory_relation 전무)과는 다르며, limit 밖 관계는 여기서 고아로 보인다.
   */
  ns.filterConnectedNodes = function filterConnectedNodes(nodes, edges) {
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const edgeList = Array.isArray(edges) ? edges : [];
    const nodeIds = new Set(nodeList.map((node) => node.id));
    const keptEdges = edgeList.filter(
      (edge) =>
        nodeIds.has(ns.getEdgeNodeId(edge.source)) && nodeIds.has(ns.getEdgeNodeId(edge.target))
    );
    const connectedIds = new Set();
    for (const edge of keptEdges) {
      connectedIds.add(ns.getEdgeNodeId(edge.source));
      connectedIds.add(ns.getEdgeNodeId(edge.target));
    }
    const visibleNodes = nodeList.filter((node) => connectedIds.has(node.id));
    return {
      nodes: visibleNodes,
      edges: keptEdges,
      hiddenCount: nodeList.length - visibleNodes.length,
    };
  };

  ns.bindDomRefs = function bindDomRefs() {
    ns.dom = {
      svgEl: document.getElementById('graph'),
      loadingEl: document.getElementById('loading'),
      emptyEl: document.getElementById('empty-msg'),
      errorEl: document.getElementById('error-msg'),
      tooltip: document.getElementById('tooltip'),
      detailPanel: document.getElementById('detail-panel'),
      detailContent: document.getElementById('detail-content'),
      impSlider: document.getElementById('importance-slider'),
      impVal: document.getElementById('importance-val'),
      applyBtn: document.getElementById('apply-btn'),
      resetBtn: document.getElementById('reset-btn'),
      searchInput: document.getElementById('graph-search'),
      searchBtn: document.getElementById('search-btn'),
      matchBadge: document.getElementById('graph-match-badge'),
      fullGraphToggle: document.getElementById('full-graph-toggle'),
      graphModeHint: document.getElementById('graph-mode-hint'),
      orphanToggle: document.getElementById('hide-orphans-toggle'),
      orphanBadge: document.getElementById('orphan-hidden-badge'),
    };
  };

  ns.showLoading = function showLoading(v) {
    ns.dom.loadingEl.style.display = v ? 'block' : 'none';
  };

  ns.showEmpty = function showEmpty(v) {
    ns.dom.emptyEl.style.display = v ? 'block' : 'none';
  };

  ns.showError = function showError(msg) {
    ns.dom.errorEl.innerHTML = `⚠️ ${ns.escHtml(msg)}`;
    ns.dom.errorEl.style.display = 'block';
  };

  ns.clearStatus = function clearStatus() {
    ns.dom.loadingEl.style.display = 'none';
    ns.dom.emptyEl.style.display = 'none';
    ns.dom.errorEl.style.display = 'none';
  };

  ns.scheduleGraphResize = function scheduleGraphResize() {
    requestAnimationFrame(function () {
      window.dispatchEvent(new Event('resize'));
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
