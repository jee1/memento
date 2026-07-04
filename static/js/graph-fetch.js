/**
 * Memory Graph — fetch and filter URL (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_GRAPH__;
  if (!ns) {
    return;
  }

  const state = ns.state;

  ns.buildUrl = function buildUrl() {
    const { impSlider, fullGraphToggle } = ns.dom;
    const checked = [...document.querySelectorAll('.type-check input:checked')].map((el) => el.value);
    const params = new URLSearchParams();
    if (checked.length < 4 && checked.length > 0) {
      params.set('types', checked.join(','));
    }
    const imp = parseFloat(impSlider.value);
    if (imp > 0) {
      params.set('min_importance', imp.toFixed(2));
    }
    if (fullGraphToggle.checked) {
      params.set('view', 'full');
      params.set('fields', 'minimal');
    }
    const q = params.toString();
    return `/admin/graph${q ? `?${q}` : ''}`;
  };

  ns.updateGraphModeHint = function updateGraphModeHint(meta) {
    const { graphModeHint } = ns.dom;
    if (!meta) {
      graphModeHint.style.display = 'none';
      graphModeHint.textContent = '';
      return;
    }
    const total = meta.total_available_nodes ?? meta.total_nodes ?? 0;
    const shown = meta.total_nodes ?? 0;
    const mode = meta.graph_view === 'full' ? '전체' : '기본';
    const suffix = meta.truncated ? ` / ${total}개 중 ${shown}개 표시` : ` / ${shown}개 표시`;
    graphModeHint.textContent = `${mode} 모드${suffix}`;
    graphModeHint.style.display = 'inline';
  };

  function resetGraphState() {
    state.lastGraphNodes = null;
    state.lastGraphEdges = null;
    state.lastGraphMeta = null;
    state.renderedNodeSelection = null;
    state.renderedLinkSelection = null;
    ns.updateGraphModeHint(null);
    d3.select(ns.dom.svgEl).selectAll('*').remove();
    if (state.simulation) {
      state.simulation.stop();
      state.simulation = null;
    }
  }

  function handleGraphPayload(data) {
    ns.updateGraphModeHint(state.lastGraphMeta);
    if (!data.nodes || data.nodes.length === 0) {
      ns.applySearchHighlight();
      ns.showEmpty(true);
      ns.scheduleGraphResize();
      return;
    }
    const edges = data.edges ?? [];
    state.lastGraphNodes = data.nodes;
    state.lastGraphEdges = edges;
    ns.renderGraph(data.nodes, edges);
    ns.scheduleGraphResize();
  }

  ns.loadGraph = async function loadGraph(url) {
    ns.clearStatus();
    ns.showLoading(true);
    resetGraphState();

    try {
      const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
      const res = await fetchFn(url);
      if (!res.ok) {
        throw new Error(`서버 오류 ${res.status}`);
      }
      const data = await res.json();
      ns.showLoading(false);
      state.lastGraphMeta = data.meta ?? null;
      handleGraphPayload(data);
    } catch (err) {
      ns.showLoading(false);
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류';
      ns.showError(errorMessage);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
