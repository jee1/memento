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

  /**
   * 다음 페인트 이후에 콜백 실행. 브라우저 밖(테스트)에서는 동기 실행한다.
   *
   * rAF 콜백은 그 프레임의 페인트 '이전'에 돈다. 한 번만 감싸면 display 전환과
   * textContent 주입이 브라우저 입장에서 같은 페인트에 합쳐질 수 있어, 스크린리더가
   * "갱신 시점에 숨어 있던 요소"로 보고 announce 를 건너뛸 수 있다 (issue 955).
   * 두 번 감싸면 첫 프레임이 display 전환을 페인트한 뒤 다음 프레임에서 텍스트가
   * 들어간다 — 라이브 리전에 널리 쓰이는 이중 rAF 패턴이다.
   */
  ns.nextFrame = function nextFrame(callback) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(callback);
      });
      return;
    }
    callback();
  };

  /**
   * 라이브 리전 배지 갱신 (issue 950).
   * 숨김 상태에서 표시로 바뀔 때 display 전환과 textContent 주입을 분리해야
   * 스크린리더가 "갱신 시점에 숨어 있던 요소"로 보지 않고 announce 한다.
   * text 가 빈 문자열이면 숨긴다.
   *
   * "이미 보임"은 el.style.display 문자열로 판정하면 안 된다: 숨김→표시 전환 시
   * display 는 nextFrame 호출 전에 동기로 'inline-block' 이 되므로, 같은 틱에서
   * 재호출하면 빠른 경로가 textContent 를 즉시 써 버려 display 전환과 텍스트
   * 주입이 다시 한 틱에 합쳐진다. 커밋된 페인트 상태만 __badgeCommitted 로 추적.
   */
  ns.setBadgeText = function setBadgeText(el, text) {
    if (!el) {
      return;
    }
    el.__badgePendingText = text;
    if (!text) {
      el.__badgeCommitted = false;
      el.textContent = '';
      el.style.display = 'none';
      return;
    }
    // R2: 이전 프레임에서 이미 커밋된 경우에만 즉시 갱신 (style.display 금지)
    if (el.__badgeCommitted) {
      el.textContent = text;
      return;
    }
    el.style.display = 'inline-block';
    ns.nextFrame(function () {
      if (el.__badgePendingText !== text) {
        return; // R5: 그 사이 숨겨졌거나 다른 값으로 덮였다
      }
      el.textContent = text;
      el.__badgeCommitted = true;
    });
  };

  ns.scheduleGraphResize = function scheduleGraphResize() {
    requestAnimationFrame(function () {
      window.dispatchEvent(new Event('resize'));
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
