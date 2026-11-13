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
    localMode: false,
    localFocusId: null,
    localDepth: 2,
    zoomBehavior: null,
    svg: null,
    zoomLayer: null,
    userAdjustedZoom: false,
  };

  /** Zoom scale below which node labels are hidden (issue 1689). */
  ns.GRAPH_LABEL_HIDE_K = 0.4;

  /**
   * Auto-fit stage gate (issue 1689). Early tick keeps a fast first frame;
   * end re-fits after layout settles and refreshes scaleExtent from final bbox.
   * User zoom/pan skips every remaining auto stage.
   *
   * @param {'early'|'end'} stage
   * @param {{ userAdjustedZoom?: boolean, earlyFitDone?: boolean, endFitDone?: boolean }} flags
   * @returns {boolean}
   */
  ns.shouldRunGraphAutoFitStage = function shouldRunGraphAutoFitStage(stage, flags) {
    const state = flags || {};
    if (state.userAdjustedZoom) {
      return false;
    }
    if (stage === 'early') {
      return !state.earlyFitDone;
    }
    if (stage === 'end') {
      return !state.endFitDone;
    }
    return false;
  };

  /**
   * Pure bbox → zoom transform for the memory graph (issue 1689).
   * No DOM. Returns null when there are no placed nodes.
   *
   * @param {Array<{x?: number, y?: number}>} nodes
   * @param {{ width: number, height: number, padding?: number, maxScale?: number, minFloor?: number }} viewport
   * @returns {{ k: number, tx: number, ty: number, scaleExtentMin: number, kFit: number } | null}
   */
  ns.computeGraphFitTransform = function computeGraphFitTransform(nodes, viewport) {
    const width = Number(viewport && viewport.width);
    const height = Number(viewport && viewport.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    const padding = viewport.padding != null ? Number(viewport.padding) : 60;
    const maxScale = viewport.maxScale != null ? Number(viewport.maxScale) : 2;
    const minFloor = viewport.minFloor != null ? Number(viewport.minFloor) : 0.1;
    const pad = Number.isFinite(padding) ? padding : 60;
    const cap = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : 2;
    const floor = Number.isFinite(minFloor) && minFloor > 0 ? minFloor : 0.1;

    const list = Array.isArray(nodes) ? nodes : [];
    const placed = list.filter(
      (node) =>
        node &&
        Number.isFinite(node.x) &&
        Number.isFinite(node.y)
    );
    if (placed.length === 0) {
      return null;
    }

    let minX = placed[0].x;
    let maxX = placed[0].x;
    let minY = placed[0].y;
    let maxY = placed[0].y;
    for (let i = 1; i < placed.length; i += 1) {
      const x = placed[i].x;
      const y = placed[i].y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const spanX = Math.max(maxX - minX, 1) + pad * 2;
    const spanY = Math.max(maxY - minY, 1) + pad * 2;
    const kFit = Math.min(width / spanX, height / spanY, cap);
    const scaleExtentMin = Math.min(floor, kFit * 0.8);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return {
      k: kFit,
      kFit,
      tx: width / 2 - centerX * kFit,
      ty: height / 2 - centerY * kFit,
      scaleExtentMin,
    };
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
   * DB orphan(삭제되지 않은 기억 사이의 memory_relation 전무)과는 다르며, limit 밖 관계는 여기서 고아로 보인다.
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

  /**
   * 클릭한 노드에서 무방향 BFS 로 depth 홉(1..3) 안의 노드·엣지만 남긴다.
   * focus 가 없으면 입력을 그대로 돌려준다.
   */
  ns.trimToLocalDepth = function trimToLocalDepth(nodes, edges, focusId, depth) {
    if (focusId == null || focusId === '') {
      return { nodes, edges };
    }
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const edgeList = Array.isArray(edges) ? edges : [];
    let hops = Math.floor(Number(depth));
    if (!Number.isFinite(hops)) {
      hops = 2;
    } else if (hops < 1) {
      hops = 1;
    } else if (hops > 3) {
      hops = 3;
    }

    const adjacent = new Map();
    const link = (from, to) => {
      if (from == null || to == null) {
        return;
      }
      const list = adjacent.get(from);
      if (list) {
        list.push(to);
      } else {
        adjacent.set(from, [to]);
      }
    };
    for (const edge of edgeList) {
      const sourceId = ns.getEdgeNodeId(edge.source);
      const targetId = ns.getEdgeNodeId(edge.target);
      link(sourceId, targetId);
      if (sourceId !== targetId) {
        link(targetId, sourceId);
      }
    }

    const keep = new Set([focusId]);
    let frontier = [focusId];
    for (let hop = 0; hop < hops; hop += 1) {
      const next = [];
      for (const id of frontier) {
        const neighbors = adjacent.get(id) ?? [];
        for (const neighborId of neighbors) {
          if (!keep.has(neighborId)) {
            keep.add(neighborId);
            next.push(neighborId);
          }
        }
      }
      frontier = next;
    }

    return {
      nodes: nodeList.filter((node) => keep.has(node.id)),
      edges: edgeList.filter((edge) => {
        const sourceId = ns.getEdgeNodeId(edge.source);
        const targetId = ns.getEdgeNodeId(edge.target);
        return keep.has(sourceId) && keep.has(targetId);
      }),
    };
  };

  ns.updateLocalFocusHint = function updateLocalFocusHint(node) {
    const hint = ns.dom && ns.dom.localFocusHint;
    if (!hint) {
      return;
    }
    const id = ns.state.localFocusId;
    if (id == null || id === '') {
      hint.textContent = '';
      hint.title = '';
      return;
    }
    const matched = node && node.id === id
      ? node
      : (ns.state.rawGraphNodes ?? []).find((item) => item.id === id);
    const label = matched && matched.label;
    hint.textContent = label && label !== id ? `${label} (${id})` : String(id);
    hint.title = String(id);
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
      fitViewBtn: document.getElementById('fit-view-btn'),
      searchInput: document.getElementById('graph-search'),
      searchBtn: document.getElementById('search-btn'),
      matchBadge: document.getElementById('graph-match-badge'),
      fullGraphToggle: document.getElementById('full-graph-toggle'),
      graphModeHint: document.getElementById('graph-mode-hint'),
      orphanToggle: document.getElementById('hide-orphans-toggle'),
      orphanBadge: document.getElementById('orphan-hidden-badge'),
      localModeToggle: document.getElementById('local-mode-toggle'),
      localDepthSelect: document.getElementById('local-depth-select'),
      localFocusHint: document.getElementById('local-focus-hint'),
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
