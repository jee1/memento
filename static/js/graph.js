/**
 * Memory Graph — event wiring and init (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_GRAPH__;
  if (!ns) {
    return;
  }

  const state = ns.state;

  ns.bindDomRefs();

  const { impSlider, impVal, applyBtn, resetBtn, searchInput, searchBtn, detailPanel, svgEl, orphanToggle } =
    ns.dom;

  impSlider.addEventListener('input', () => {
    impVal.textContent = parseFloat(impSlider.value).toFixed(2);
  });

  applyBtn.addEventListener('click', () => {
    state.activeSearchQuery = searchInput.value;
    ns.loadGraph(ns.buildUrl());
  });

  orphanToggle.addEventListener('change', () => {
    if (!state.rawGraphNodes) {
      return; // 아직 로드 전이거나 직전 요청이 실패했다 — 에러 표시를 덮지 않는다
    }
    ns.renderVisibleGraph();
  });

  searchBtn.addEventListener('click', ns.applySearchFromInput);

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      ns.applySearchFromInput();
    }
  });

  searchInput.addEventListener('input', () => {
    if (searchInput.value.trim() === '' && state.activeSearchQuery !== '') {
      state.activeSearchQuery = '';
      ns.applySearchHighlight();
    }
  });

  resetBtn.addEventListener('click', () => {
    document.querySelectorAll('.type-check input').forEach((el) => {
      el.checked = true;
    });
    impSlider.value = '0';
    impVal.textContent = '0.0';
    searchInput.value = '';
    state.activeSearchQuery = '';
    ns.dom.fullGraphToggle.checked = false;
    orphanToggle.checked = false;
    ns.loadGraph('/admin/graph');
  });

  document.addEventListener('click', (event) => {
    if (!detailPanel.contains(event.target) && !svgEl.contains(event.target)) {
      ns.closePanel();
    }
  });

  window.addEventListener('resize', () => {
    if (!state.lastGraphNodes || state.lastGraphNodes.length === 0) {
      return;
    }
    clearTimeout(state.resizeRedrawTimer);
    state.resizeRedrawTimer = setTimeout(() => {
      ns.renderGraph(state.lastGraphNodes, state.lastGraphEdges ?? []);
    }, 120);
  });

  ns.loadGraph('/admin/graph');
})(typeof window !== 'undefined' ? window : globalThis);
