/**
 * Anchor Map — D3 rendering: map, nodes, links, labels, detail panel.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_ANCHOR_MAP__;
  if (!ns) return;

  const escapeHtml = ns.escapeHtml;
  const state = ns.state;

  function focusOnNode(node, scale) {
    const s = scale || 1.5;
    if (!node || node.x == null || node.y == null || !state.zoomBehavior || !state.svg) return;
    const width = parseFloat(state.svg.attr('width'));
    const height = parseFloat(state.svg.attr('height'));
    const transform = d3.zoomIdentity
      .translate(width / 2 - node.x * s, height / 2 - node.y * s)
      .scale(s);
    state.svg.transition().duration(750).call(state.zoomBehavior.transform, transform);
  }

  // 검색 자동 포커스(1.5배)와 앵커 클릭(2배)이 확대해 놓은 뷰를 되돌릴 수단이 없었다.
  // 노드 bbox 를 캔버스에 맞춰 zoomIdentity 를 다시 계산한다 (issue 874).
  function fitToNodes() {
    if (!state.svg || !state.zoomBehavior || !Array.isArray(state.nodes)) return;
    const placed = state.nodes.filter(function (n) { return n.x != null && n.y != null; });
    if (placed.length === 0) return;

    const width = parseFloat(state.svg.attr('width'));
    const height = parseFloat(state.svg.attr('height'));
    const xs = placed.map(function (n) { return n.x; });
    const ys = placed.map(function (n) { return n.y; });
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);

    // 노드 반지름·라벨이 bbox 밖으로 나가므로 여백을 둔다
    const padding = 60;
    const spanX = Math.max(maxX - minX, 1) + padding * 2;
    const spanY = Math.max(maxY - minY, 1) + padding * 2;
    const scale = Math.min(width / spanX, height / spanY, 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const transform = d3.zoomIdentity
      .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
      .scale(scale);
    state.svg.transition().duration(750).call(state.zoomBehavior.transform, transform);
    ns.debugAnchorMap('map-fit', { nodes: placed.length, scale: scale });
  }

  function buildAnchorDetailHtml(node) {
    const slot = escapeHtml(node.slot);
    const id = escapeHtml(node.id);
    const content = escapeHtml(node.content);
    const importance = escapeHtml(node.importance != null ? node.importance : 'N/A');
    const created = node.created_at ? escapeHtml(new Date(node.created_at).toLocaleString()) : 'N/A';
    return [
      '<div class="memory-detail-item"><label>Type:</label><div class="value">Anchor (Slot ' + slot + ')</div></div>',
      '<div class="memory-detail-item"><label>Memory ID:</label><div class="value">' + id + '</div></div>',
      '<div class="memory-detail-item"><label>Content:</label><div class="value">' + content + '</div></div>',
      '<div class="memory-detail-item"><label>Hop Distance:</label><div class="value">0 (Anchor)</div></div>',
      '<div class="memory-detail-item"><label>Similarity:</label><div class="value">1.0 (100.0%)</div></div>',
      '<div class="memory-detail-item"><label>Importance:</label><div class="value">' + importance + '</div></div>',
      '<div class="memory-detail-item"><label>Created:</label><div class="value">' + created + '</div></div>',
      node.pinned
        ? '<div class="memory-detail-item"><label>배치:</label><div class="value">📌 고정됨 ' +
          '<button type="button" class="m-button m-button--ghost js-unpin-node" data-memory-id="' + id + '">고정 해제</button></div></div>'
        : '',
    ].join('');
  }

  function buildMemoryDetailHtml(node) {
    const id = escapeHtml(node.id);
    const content = escapeHtml(node.content);
    const hopDistance = escapeHtml(node.hop_distance != null ? node.hop_distance : 'N/A');
    const similarity = node.similarity != null ? escapeHtml((node.similarity * 100).toFixed(1) + '%') : 'N/A';
    const importance = escapeHtml(node.importance != null ? node.importance : 'N/A');
    const created = node.created_at ? escapeHtml(new Date(node.created_at).toLocaleString()) : 'N/A';
    return [
      '<div class="memory-detail-item"><label>Type:</label><div class="value">Memory</div></div>',
      '<div class="memory-detail-item"><label>Memory ID:</label><div class="value">' + id + '</div></div>',
      '<div class="memory-detail-item"><label>Content:</label><div class="value">' + content + '</div></div>',
      '<div class="memory-detail-item"><label>Hop Distance:</label><div class="value">' + hopDistance + '</div></div>',
      '<div class="memory-detail-item"><label>Similarity:</label><div class="value">' + similarity + '</div></div>',
      '<div class="memory-detail-item"><label>Importance:</label><div class="value">' + importance + '</div></div>',
      '<div class="memory-detail-item"><label>Created:</label><div class="value">' + created + '</div></div>',
      node.pinned
        ? '<div class="memory-detail-item"><label>배치:</label><div class="value">📌 고정됨 ' +
          '<button type="button" class="m-button m-button--ghost js-unpin-node" data-memory-id="' + id + '">고정 해제</button></div></div>'
        : '',
    ].join('');
  }

  function displayMemoryDetails(node) {
    const detailsContainer = document.getElementById('memory-details');
    if (!detailsContainer) return;
    detailsContainer.innerHTML = node.type === 'anchor'
      ? buildAnchorDetailHtml(node)
      : buildMemoryDetailHtml(node);
  }

  function layoutNodesByHop() {
    // hop 별 기본 거리는 자동 정렬 모드 전용이다 — 일시정지 중에는 좌표를 손대지 않는다 (issue 894).
    if (state.layoutMode !== 'auto') return;

    const nodes = state.nodes;
    const links = state.links;
    const width = state.svg.attr('width');
    const height = state.svg.attr('height');
    const centerX = width / 2;
    const centerY = height / 2;
    const anchorNodes = nodes.filter(function (n) { return n.type === 'anchor'; });

    anchorNodes.forEach(function (anchor, anchorIndex) {
      const angle = (anchorIndex / anchorNodes.length) * 2 * Math.PI;
      const radius = 150;
      if (!anchor.pinned) {
        anchor.fx = centerX + Math.cos(angle) * radius;
        anchor.fy = centerY + Math.sin(angle) * radius;
      }

      const relatedMemories = nodes.filter(function (n) {
        return n.type === 'memory' && links.some(function (l) {
          return (l.source.id === anchor.id && l.target.id === n.id) ||
                 (l.target.id === anchor.id && l.source.id === n.id);
        });
      });

      // Seed x/y only: pinning memories with fx/fy makes charge and collision inert (issue 867).
      relatedMemories.forEach(function (memory, memIndex) {
        if (memory.pinned || memory.x != null) return;
        const hop = memory.hop_distance || 1;
        const layerRadius = 100 + (hop - 1) * 80;
        const memAngle = (memIndex / relatedMemories.length) * 2 * Math.PI + angle;
        memory.x = anchor.fx + Math.cos(memAngle) * layerRadius;
        memory.y = anchor.fy + Math.sin(memAngle) * layerRadius;
      });
    });
  }

  function makeDragBehavior(simulation) {
    const PIN_DRAG_THRESHOLD_PX = 3;
    function dragstarted(event, d) {
      state.activeDragCount += 1;   // 재렌더 지연 시작 (issue 948)
      d._dragStartX = d.x;
      d._dragStartY = d.y;
      // 정지 모드에서는 시뮬레이션을 깨우지 않는다
      if (state.layoutMode === 'auto' && !event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
      // 정지 중에는 tick 이 돌지 않으므로 직접 다시 그린다
      if (state.layoutMode !== 'auto' && state.redrawTick) state.redrawTick();
    }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      const startX = d._dragStartX;
      const startY = d._dragStartY;
      delete d._dragStartX;
      delete d._dragStartY;
      const moved = (startX != null && startY != null)
        ? Math.hypot((d.fx != null ? d.fx : d.x) - startX, (d.fy != null ? d.fy : d.y) - startY)
        : 0;
      // 놓은 자리를 유지한다 — fx/fy 를 풀면 force 평형점으로 되돌아간다 (issue 894)
      if (moved >= PIN_DRAG_THRESHOLD_PX) {
        d.pinned = true;
        applyPinVisual(d);
        persistPinnedLayout();
      } else if (!d.pinned) {
        // 클릭만 한 경우 앵커 자동 고정은 layout 이 다시 박고, 메모리는 자유로 둔다
        if (d.type !== 'anchor') {
          d.fx = null;
          d.fy = null;
        }
      }
      // pin 확정·저장이 끝난 뒤에 밀린 갱신을 반영한다. 순서가 뒤바뀌면 mergeNodeLayout 의
      // prevById 우선순위가 아직 pin 이 반영되지 않은 이전 상태를 고수해 방금 확정한 pin 을 덮어쓴다 (issue 948).
      if (state.activeDragCount > 0) state.activeDragCount -= 1;
      if (state.activeDragCount === 0) flushDeferredRender();
    }
    return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
  }

  function buildLinkSelection(g, links) {
    return g.append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', function (d) { return 'link ' + d.type; })
      .attr('stroke-width', function (d) { return d.type === 'hop' ? 2 : 1.5; });
  }

  function buildNodeSelection(g, nodes, palette, simulation) {
    return g.append('g')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('class', function (d) {
        let classes = 'node ' + d.type;
        if (d.type === 'anchor' && d.slot) classes += ' slot-' + d.slot.toLowerCase();
        return classes;
      })
      .attr('r', function (d) { return d.radius; })
      .attr('fill', function (d) {
        return (d.type === 'anchor' && d.slot) ? palette.slotColors[d.slot].fill : palette.memoryFill;
      })
      .attr('stroke', function (d) {
        return (d.type === 'anchor' && d.slot) ? palette.slotColors[d.slot].stroke : palette.memoryStroke;
      })
      .attr('stroke-width', function (d) { return d.type === 'anchor' ? 3 : 2; })
      .attr('stroke-dasharray', function (d) { return d.embedding_missing ? '5,3' : null; })
      .attr('opacity', function (d) { return d.embedding_missing ? 0.6 : 1.0; })
      .call(makeDragBehavior(simulation))
      .on('click', function (event, d) { event.stopPropagation(); ns.selectNode(d); });
  }

  function labelTextFor(d) {
    let text;
    if (d.type === 'anchor' && d.slot) text = 'Slot ' + d.slot;
    else text = d.content.substring(0, 20) + (d.content.length > 20 ? '...' : '');
    if (d.pinned) text += ' 📌';
    return text;
  }

  function tooltipTextFor(d) {
    const pinHint = d.pinned ? '\n📌 고정됨 (드래그로 이동 · 상세 패널에서 해제)' : '';
    if (d.type === 'anchor') {
      const warning = d.embedding_missing ? '\n⚠ 임베딩 없음 — 연결 메모리 검색 불가' : '';
      return 'Anchor ' + d.slot + '\n' + d.content + warning + pinHint;
    }
    return 'Memory\n' + d.content + '\nHop: ' + (d.hop_distance || 'N/A') + pinHint;
  }

  function applyPinVisual() {
    if (!state.svg) return;
    state.svg.selectAll('.node').classed('pinned', function (d) { return Boolean(d.pinned); });
    state.svg.selectAll('.node-label').text(labelTextFor);
    state.svg.selectAll('.node title').text(tooltipTextFor);
  }

  function persistPinnedLayout() {
    if (state.layoutPersistDisabled) return;
    const agentId = (state.mapData && state.mapData.agent_id) || ns.getSelectedAgentId();
    const pinned = (state.nodes || []).filter(function (n) { return n.pinned; });
    const result = ns.writeAgentLayout(global.localStorage, agentId, pinned);
    if (result && result.ok === false) {
      state.layoutPersistDisabled = true;
    }
  }

  // 드래그 중 밀어 둔 갱신을 한 번 흘려보낸다. state.mapData 는 항상 최신 1건이므로
  // 큐 없이 boolean 만으로 coalesce 된다 (issue 948).
  function flushDeferredRender() {
    if (!state.pendingRefreshRender) return;
    state.pendingRefreshRender = false;
    ns.debugAnchorMap('render-deferred-flushed');
    ns.renderMap();
  }

  // dragended 가 유실된 경우(창 밖 mouseup 등)에도 지연 갱신이 영구히 묶이지 않게 한다.
  function releaseDragDeferral() {
    if (state.activeDragCount === 0) return;
    state.activeDragCount = 0;
    flushDeferredRender();
  }

  function buildLabelSelection(g, nodes, palette) {
    return g.append('g')
      .selectAll('text')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('dx', function (d) { return d.radius + 5; })
      .attr('dy', 4)
      .text(labelTextFor)
      .style('font-size', '12px')
      .style('fill', palette.labelFill)
      .style('pointer-events', 'none');
  }

  function addNodeTooltips(nodeSelection) {
    nodeSelection.append('title').text(tooltipTextFor);
  }

  function runSimulation(link, node, label) {
    const simulation = state.simulation;
    const tick = function () {
      link.attr('x1', function (d) { return d.source.x; })
          .attr('y1', function (d) { return d.source.y; })
          .attr('x2', function (d) { return d.target.x; })
          .attr('y2', function (d) { return d.target.y; });
      node.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
      label.attr('x', function (d) { return d.x; }).attr('y', function (d) { return d.y; });
    };
    state.redrawTick = tick;
    simulation.nodes(state.nodes).on('tick', tick);

    const linkForce = simulation.force('link');
    linkForce.links(state.links);
    // 자동 정렬일 때만 hop 별 거리를 적용한다. 정지 중에는 평탄 거리로 두어
    // 나중에 자동 정렬로 돌아왔을 때만 hop 계조가 살아난다 (issue 894).
    linkForce.distance(state.layoutMode === 'auto' ? ns.hopLinkDistance : ns.LAYOUT_DEFAULT_DISTANCE);

    if (state.layoutMode === 'auto') {
      simulation.alpha(1).restart();
    } else {
      simulation.stop();
      tick();
    }
  }

  // 상태 안내(빈/오류/로딩)는 서로 배타다 — 한 곳에서 셋을 모두 지우고 하나만 그린다.
  // zoom 대상인 <g> 밖에 둬야 확대/이동에 끌려다니지 않는다 (issue 872, 904).
  const MAP_STATUS_CLASSES = {
    empty: 'map-empty-message',
    error: 'map-error-message',
    loading: 'map-loading-message',
  };

  function setMapStatusMessage(kind, message) {
    if (!state.svg) return;
    const key = kind ? kind + '\0' + message : null;
    if (key === state.mapStatusKey) return;   // 같은 실패의 반복 폴링을 흡수 (issue 904)
    state.mapStatusKey = key;

    for (const className of Object.values(MAP_STATUS_CLASSES)) {
      state.svg.selectAll('.' + className).remove();
    }
    if (!kind) return;

    // 오류·로딩은 이미 그려진 그래프 위에 뜰 수 있어 상단에, 빈 상태는 중앙에 둔다.
    const y = kind === 'empty' ? parseFloat(state.svg.attr('height')) / 2 : 24;
    state.svg.append('text')
      .attr('class', MAP_STATUS_CLASSES[kind])
      .attr('x', parseFloat(state.svg.attr('width')) / 2)
      .attr('y', y)
      .attr('text-anchor', 'middle')
      .text(message);
    ns.debugAnchorMap('map-status', { kind: kind });
  }

  function renderMap() {
    if (!state.svg || !state.simulation) return;

    // 재렌더는 g.selectAll('*').remove() 로 노드 DOM 을 갈아치우므로 진행 중인 d3 drag 제스처가
    // 끊긴다. 최신 페이로드는 호출부가 이미 state.mapData 에 넣어 두었으니 플래그만 세우고
    // dragended 에서 한 번만 반영한다 — 버리지 않고 지연시킨다 (issue 948).
    if (state.activeDragCount > 0) {
      state.pendingRefreshRender = true;
      ns.debugAnchorMap('render-deferred-during-drag', { drags: state.activeDragCount });
      return;
    }

    state.mapData = ns.normalizeMapData(state.mapData);
    const mapData = state.mapData;

    setMapStatusMessage(null);

    if (!mapData || !mapData.nodes || mapData.nodes.length === 0) {
      state.nodes = [];
      state.links = [];
      const g = state.svg.select('g');
      if (g.node()) g.selectAll('*').remove();
      else state.svg.selectAll('*').remove();
      const agentId = mapData && mapData.agent_id ? mapData.agent_id : ns.getSelectedAgentId();
      setMapStatusMessage('empty', 'agent "' + agentId + '" 에는 앵커가 없습니다 — set_anchor 로 설정하세요');
      return;
    }

    const g = state.svg.select('g');
    g.selectAll('*').remove();

    const palette = ns.getAnchorMapPalette();

    const agentId = mapData.agent_id || ns.getSelectedAgentId();
    const stored = ns.readAgentLayout(global.localStorage, agentId);
    const merged = ns.mergeNodeLayout(mapData.nodes, state.nodes, stored);

    // 삭제된 노드만 저장소에서 지운다 — 존속 노드의 좌표·pin 은 건드리지 않는다 (issue 894)
    if (merged.removedIds.length) {
      ns.pruneStoredNodes(global.localStorage, agentId, merged.nodes.map(function (n) { return n.id; }));
    }

    state.nodes = merged.nodes.map(function (d) { return { ...d, radius: d.type === 'anchor' ? 12 : 8 }; });
    state.links = mapData.links
      .map(function (d) {
        return {
          ...d,
          source: typeof d.source === 'string' ? state.nodes.find(function (n) { return n.id === d.source; }) : d.source,
          target: typeof d.target === 'string' ? state.nodes.find(function (n) { return n.id === d.target; }) : d.target,
        };
      })
      .filter(function (d) { return d.source && d.target; });

    layoutNodesByHop();

    const link = buildLinkSelection(g, state.links);
    const node = buildNodeSelection(g, state.nodes, palette, state.simulation);
    buildLabelSelection(g, state.nodes, palette);
    addNodeTooltips(node);
    runSimulation(link, node, state.svg.selectAll('.node-label'));
    applyPinVisual();

    if (state.searchResults && state.searchResults.items && state.searchResults.items.length) {
      // 재렌더 시에는 하이라이트만 복원한다 — 자동 포커스는 새 검색에서만 (issue 870).
      ns.highlightSearchResults({ autoFocus: false });
    }

    // 재렌더는 g 를 통째로 지우므로 선택 표시도 함께 날아간다. 상세 패널은 그대로 남아 있어
    // 복원하지 않으면 "패널엔 내용이 있는데 맵엔 선택이 없는" 어긋난 상태가 된다 (issue 870).
    if (state.selectedNodeId && state.nodes.some(function (n) { return n.id === state.selectedNodeId; })) {
      markNodeSelected(state.selectedNodeId);
    }
  }

  // 선택 표시(맵)와 상세 렌더(패널)를 분리한다 — 검색 맥락에서는 상세를 검색 항목으로 그려야
  // 목록과 같은 유사도가 나온다. 맵 노드의 similarity 는 앵커 기준이라 축이 다르다 (issue 871).
  function markNodeSelected(memoryId) {
    if (!state.svg) return;
    state.selectedNodeId = memoryId;
    state.svg.selectAll('.node').classed('selected', function (d) { return d.id === memoryId; });
  }

  function selectNode(node) {
    markNodeSelected(node.id);
    displayMemoryDetails(node);
  }

  function selectAnchorNode(memoryId) {
    if (!Array.isArray(state.nodes)) return;
    const node = state.nodes.find(function (n) { return n.id === memoryId; });
    if (node) {
      selectNode(node);
      focusOnNode(node, 2);
    }
  }

  function updateAnchorList() {
    const anchorListContainer = document.getElementById('anchor-list');
    if (!anchorListContainer) return;
    state.mapData = ns.normalizeMapData(state.mapData);
    const mapData = state.mapData;

    if (!mapData || !mapData.anchors || mapData.anchors.length === 0) {
      anchorListContainer.innerHTML = '<p class="no-data">No anchors set</p>';
      return;
    }

    anchorListContainer.innerHTML = mapData.anchors
      .map(function (anchor) {
        if (!anchor.memory_id) return '';
        const memory = mapData.nodes.find(function (n) { return n.id === anchor.memory_id; });
        const slot = escapeHtml(anchor.slot);
        const slotClass = /^[ABC]$/i.test(anchor.slot) ? slot.toLowerCase() : 'a';
        const memoryId = escapeHtml(anchor.memory_id);
        const contentPreview = memory ? escapeHtml(memory.content.substring(0, 50)) + '...' : '';
        return '<div class="anchor-item slot-' + slotClass + ' js-select-anchor" data-memory-id="' + memoryId + '">' +
          '<div class="slot-label">Slot ' + slot + '</div>' +
          '<div class="memory-id">' + memoryId + '</div>' +
          (memory ? '<div class="anchor-item-preview">' + contentPreview + '</div>' : '') +
          '</div>';
      })
      .join('');
  }

  function updateLayoutModeButton() {
    const btn = document.getElementById('layout-mode-btn');
    if (!btn) return;
    const paused = state.layoutMode === 'paused';
    btn.textContent = paused ? '자동 정렬' : '정렬 일시정지';
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }

  function setLayoutMode(mode) {
    state.layoutMode = mode === 'paused' ? 'paused' : 'auto';
    updateLayoutModeButton();
    if (!state.simulation) return;
    if (state.layoutMode === 'auto') {
      const linkForce = state.simulation.force('link');
      if (linkForce && typeof linkForce.distance === 'function') {
        linkForce.distance(ns.hopLinkDistance);
      }
      layoutNodesByHop();
      state.simulation.alpha(0.5).restart();
    } else {
      const linkForce = state.simulation.force('link');
      if (linkForce && typeof linkForce.distance === 'function') {
        linkForce.distance(ns.LAYOUT_DEFAULT_DISTANCE);
      }
      state.simulation.stop();
      if (state.redrawTick) state.redrawTick();
    }
  }

  function unpinNode(memoryId) {
    if (!Array.isArray(state.nodes)) return;
    const node = state.nodes.find(function (n) { return n.id === memoryId; });
    if (!node) return;
    node.pinned = false;
    node.fx = null;
    node.fy = null;
    if (node.type === 'anchor') {
      layoutNodesByHop();
    }
    applyPinVisual();
    persistPinnedLayout();
    if (state.layoutMode === 'auto' && state.simulation) {
      state.simulation.alpha(0.3).restart();
    } else if (state.redrawTick) {
      state.redrawTick();
    }
    if (state.selectedNodeId === memoryId) {
      displayMemoryDetails(node);
    }
  }

  function unpinAllNodes() {
    if (!Array.isArray(state.nodes)) return;
    state.nodes.forEach(function (node) {
      if (!node.pinned) return;
      node.pinned = false;
      node.fx = null;
      node.fy = null;
    });
    layoutNodesByHop();
    applyPinVisual();
    persistPinnedLayout();
    if (state.layoutMode === 'auto' && state.simulation) {
      state.simulation.alpha(0.3).restart();
    } else if (state.redrawTick) {
      state.redrawTick();
    }
  }

  function resetLayout() {
    const agentId = (state.mapData && state.mapData.agent_id) || ns.getSelectedAgentId();
    ns.clearAgentLayout(global.localStorage, agentId);
    state.nodes = [];
    state.layoutMode = 'auto';
    updateLayoutModeButton();
    ns.renderMap();
  }

  ns.layoutNodesByHop = layoutNodesByHop;
  ns.renderMap = renderMap;
  ns.setMapStatusMessage = setMapStatusMessage;
  ns.selectNode = selectNode;
  ns.markNodeSelected = markNodeSelected;
  ns.selectAnchorNode = selectAnchorNode;
  ns.updateAnchorList = updateAnchorList;
  ns.displayMemoryDetails = displayMemoryDetails;
  ns.focusOnNode = focusOnNode;
  ns.fitToNodes = fitToNodes;
  ns.setLayoutMode = setLayoutMode;
  ns.unpinNode = unpinNode;
  ns.unpinAllNodes = unpinAllNodes;
  ns.resetLayout = resetLayout;
  ns.applyPinVisual = applyPinVisual;
  ns.persistPinnedLayout = persistPinnedLayout;
  ns.flushDeferredRender = flushDeferredRender;
  ns.releaseDragDeferral = releaseDragDeferral;
  // 단위 테스트에서 drag 콜백을 직접 구동하기 위해 노출한다 (issue 948).
  // 선례: anchor-map-ws.js:114 ns.handleWsMessage
  ns.makeDragBehavior = makeDragBehavior;

})(typeof window !== 'undefined' ? window : globalThis);
