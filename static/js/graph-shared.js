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
