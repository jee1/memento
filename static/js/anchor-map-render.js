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
      anchor.fx = centerX + Math.cos(angle) * radius;
      anchor.fy = centerY + Math.sin(angle) * radius;

      const relatedMemories = nodes.filter(function (n) {
        return n.type === 'memory' && links.some(function (l) {
          return (l.source.id === anchor.id && l.target.id === n.id) ||
                 (l.target.id === anchor.id && l.source.id === n.id);
        });
      });

      // Seed x/y only: pinning memories with fx/fy makes charge and collision inert (issue 867).
      relatedMemories.forEach(function (memory, memIndex) {
        const hop = memory.hop_distance || 1;
        const layerRadius = 100 + (hop - 1) * 80;
        const memAngle = (memIndex / relatedMemories.length) * 2 * Math.PI + angle;
        memory.x = anchor.fx + Math.cos(memAngle) * layerRadius;
        memory.y = anchor.fy + Math.sin(memAngle) * layerRadius;
      });
    });
  }

  function makeDragBehavior(simulation) {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
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

  function buildLabelSelection(g, nodes, palette) {
    return g.append('g')
      .selectAll('text')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('dx', function (d) { return d.radius + 5; })
      .attr('dy', 4)
      .text(function (d) {
        if (d.type === 'anchor' && d.slot) return 'Slot ' + d.slot;
        return d.content.substring(0, 20) + (d.content.length > 20 ? '...' : '');
      })
      .style('font-size', '12px')
      .style('fill', palette.labelFill)
      .style('pointer-events', 'none');
  }

  function addNodeTooltips(nodeSelection) {
    nodeSelection.append('title').text(function (d) {
      if (d.type === 'anchor') {
        const warning = d.embedding_missing ? '\n⚠ 임베딩 없음 — 연결 메모리 검색 불가' : '';
        return 'Anchor ' + d.slot + '\n' + d.content + warning;
      }
      return 'Memory\n' + d.content + '\nHop: ' + (d.hop_distance || 'N/A');
    });
  }

  function runSimulation(link, node, label) {
    const simulation = state.simulation;
    const nodes = state.nodes;
    const links = state.links;
    simulation.nodes(nodes).on('tick', function () {
      link.attr('x1', function (d) { return d.source.x; })
          .attr('y1', function (d) { return d.source.y; })
          .attr('x2', function (d) { return d.target.x; })
          .attr('y2', function (d) { return d.target.y; });
      node.attr('cx', function (d) { return d.x; }).attr('cy', function (d) { return d.y; });
      label.attr('x', function (d) { return d.x; }).attr('y', function (d) { return d.y; });
    });
    simulation.force('link').links(links);
    simulation.alpha(1).restart();
  }

  // 빈 상태 안내는 zoom 대상인 <g> 밖에 둬야 확대/이동에 끌려다니지 않는다 (issue 872).
  function showEmptyMapMessage(message) {
    state.svg.selectAll('.map-empty-message').remove();
    state.svg.append('text')
      .attr('class', 'map-empty-message')
      .attr('x', parseFloat(state.svg.attr('width')) / 2)
      .attr('y', parseFloat(state.svg.attr('height')) / 2)
      .attr('text-anchor', 'middle')
      .text(message);
  }

  function renderMap() {
    if (!state.svg || !state.simulation) return;

    state.mapData = ns.normalizeMapData(state.mapData);
    const mapData = state.mapData;

    state.svg.selectAll('.map-empty-message').remove();

    if (!mapData || !mapData.nodes || mapData.nodes.length === 0) {
      state.nodes = [];
      state.links = [];
      const g = state.svg.select('g');
      if (g.node()) g.selectAll('*').remove();
      else state.svg.selectAll('*').remove();
      const agentId = mapData && mapData.agent_id ? mapData.agent_id : ns.getSelectedAgentId();
      showEmptyMapMessage('agent "' + agentId + '" 에는 앵커가 없습니다 — set_anchor 로 설정하세요');
      return;
    }

    const g = state.svg.select('g');
    g.selectAll('*').remove();

    const palette = ns.getAnchorMapPalette();

    state.nodes = mapData.nodes.map(function (d) { return { ...d, radius: d.type === 'anchor' ? 12 : 8 }; });
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

  ns.layoutNodesByHop = layoutNodesByHop;
  ns.renderMap = renderMap;
  ns.selectNode = selectNode;
  ns.markNodeSelected = markNodeSelected;
  ns.selectAnchorNode = selectAnchorNode;
  ns.updateAnchorList = updateAnchorList;
  ns.displayMemoryDetails = displayMemoryDetails;
  ns.focusOnNode = focusOnNode;
  ns.fitToNodes = fitToNodes;

})(typeof window !== 'undefined' ? window : globalThis);
