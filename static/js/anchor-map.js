/**
 * Anchor Map Visualization
 * D3.js를 사용한 네트워크 그래프 시각화
 */

// 전역 변수 (맵 미렌더/빈 데이터에서도 .find/.filter 호출 시 TypeError 방지)
let svg, simulation;
let nodes = [];
let links = [];
let mapData = null;
let searchResults = null; // 검색 결과 저장
const highlightedNodeIds = new Set(); // 하이라이트된 노드 ID 집합
let autoRefreshInterval = null; // 자동 새로고침 인터벌
let websocket = null; // WebSocket 연결

// 슬롯별 색상 토큰 정의
const slotColorTokens = {
  'A': { fill: '--color-anchor-a', stroke: '--color-anchor-a-stroke' },
  'B': { fill: '--color-anchor-b', stroke: '--color-anchor-b-stroke' },
  'C': { fill: '--color-anchor-c', stroke: '--color-anchor-c-stroke' }
};

function readAnchorMapToken(name, fallback = '') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value) {
    return value;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error(`Missing CSS token: ${name}`);
}

function getAnchorMapPalette() {
  return {
    slotColors: Object.fromEntries(
      Object.entries(slotColorTokens).map(([slot, tokenNames]) => [slot, {
        fill: readAnchorMapToken(tokenNames.fill),
        stroke: readAnchorMapToken(tokenNames.stroke),
      }])
    ),
    memoryFill: readAnchorMapToken('--color-memory-neutral'),
    memoryStroke: readAnchorMapToken('--color-memory-neutral-stroke'),
    labelFill: readAnchorMapToken('--color-text-main'),
  };
}

/** XSS 방지: HTML 특수문자 이스케이프 */
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function debugAnchorMap(eventName, detail) {
  if (window.localStorage.getItem('memento.debug') !== '1') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memento:debug', {
    bubbles: true,
    composed: true,
    detail: { scope: 'anchor-map', eventName, detail },
  }));
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  initializeMap();
  setupEventListeners();
  loadMapData();
});

/**
 * 맵 초기화
 */
function initializeMap() {
  const container = d3.select('#anchor-map');
  const width = container.node().getBoundingClientRect().width;
  const height = container.node().getBoundingClientRect().height;

  // SVG 생성
  svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Zoom 패닝 기능
  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      svg.select('g').attr('transform', event.transform);
    });

  svg.call(zoom);

  // 그룹 생성 (zoom 적용)
  svg.append('g');

  // Force simulation 설정
  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));

  // 창 크기 변경 시 SVG 크기 조정
  window.addEventListener('resize', () => {
    const newWidth = container.node().getBoundingClientRect().width;
    const newHeight = container.node().getBoundingClientRect().height;
    svg.attr('width', newWidth).attr('height', newHeight);
    simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
    simulation.alpha(1).restart();
  });
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  document.getElementById('load-map-btn').addEventListener('click', loadMapData);
  document.getElementById('refresh-btn').addEventListener('click', loadMapData);
  document.getElementById('search-btn').addEventListener('click', performSearch);
  document.getElementById('clear-search-btn').addEventListener('click', clearSearch);

  document.getElementById('memory-details')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-change-anchor');
    if (btn && btn.dataset.slot) changeAnchor(btn.dataset.slot);
  });
  document.getElementById('anchor-list')?.addEventListener('click', (e) => {
    const el = e.target.closest('.js-select-anchor');
    if (el && el.dataset.memoryId) selectAnchorNode(el.dataset.memoryId);
  });
  
  // 자동 새로고침 토글
  document.getElementById('auto-refresh-toggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
  
  // 새로고침 간격 변경
  document.getElementById('refresh-interval-select').addEventListener('change', () => {
    if (document.getElementById('auto-refresh-toggle').checked) {
      stopAutoRefresh();
      startAutoRefresh();
    }
  });
  
  document.getElementById('agent-id-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadMapData();
    }
  });
  
  document.getElementById('search-query-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  
  // WebSocket 연결 시도 (선택적)
  tryConnectWebSocket();
}

/**
 * 맵 데이터 로드
 */
async function loadMapData() {
  const agentId = document.getElementById('agent-id-input').value || 'default';
  
  try {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const response = await fetchFn(`/api/anchors/map?agent_id=${encodeURIComponent(agentId)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const newMapData = await response.json();
    
    // 데이터 변경 감지
    const hasChanged = !mapData || 
      JSON.stringify(mapData.timestamp) !== JSON.stringify(newMapData.timestamp) ||
      JSON.stringify(mapData.anchors) !== JSON.stringify(newMapData.anchors) ||
      mapData.nodes.length !== newMapData.nodes.length ||
      mapData.links.length !== newMapData.links.length;
    
    if (hasChanged) {
      mapData = newMapData;
      renderMap();
      updateAnchorList();
      debugAnchorMap('map-updated', { timestamp: newMapData.timestamp });
    } else {
      debugAnchorMap('map-unchanged');
    }
  } catch (error) {
    debugAnchorMap('load-error', { message: error.message });
    // 에러 알림은 자동 새로고침 시에는 표시하지 않음
    if (!autoRefreshInterval) {
      alert(`맵 데이터를 불러올 수 없습니다: ${error.message}`);
    }
  }
}

/**
 * 맵 렌더링
 */
function renderMap() {
  if (!mapData || !mapData.nodes || mapData.nodes.length === 0) {
    nodes = [];
    links = [];
    svg.selectAll('*').remove();
    return;
  }

  const g = svg.select('g');
  g.selectAll('*').remove();

  const palette = getAnchorMapPalette();

  // 노드와 링크 데이터 준비
  nodes = mapData.nodes.map(d => ({
    ...d,
    radius: d.type === 'anchor' ? 12 : 8
  }));

  links = mapData.links.map(d => ({
    ...d,
    source: typeof d.source === 'string' ? nodes.find(n => n.id === d.source) : d.source,
    target: typeof d.target === 'string' ? nodes.find(n => n.id === d.target) : d.target
  }));

  // Hop 거리에 따른 원형 레이어 배치 (초기 위치)
  layoutNodesByHop();

  // 링크 그리기
  const link = g.append('g')
    .selectAll('line')
    .data(links)
    .enter()
    .append('line')
    .attr('class', d => `link ${d.type}`)
    .attr('stroke-width', d => d.type === 'hop' ? 2 : 1.5);

  // 노드 그리기
  const node = g.append('g')
    .selectAll('circle')
    .data(nodes)
    .enter()
    .append('circle')
    .attr('class', d => {
      let classes = `node ${d.type}`;
      if (d.type === 'anchor' && d.slot) {
        classes += ` slot-${d.slot.toLowerCase()}`;
      }
      return classes;
    })
    .attr('r', d => d.radius)
    .attr('fill', d => {
      if (d.type === 'anchor' && d.slot) {
        return palette.slotColors[d.slot].fill;
      }
      return palette.memoryFill;
    })
    .attr('stroke', d => {
      if (d.type === 'anchor' && d.slot) {
        return palette.slotColors[d.slot].stroke;
      }
      return palette.memoryStroke;
    })
    .attr('stroke-width', d => d.type === 'anchor' ? 3 : 2)
    .attr('opacity', 1.0)
    .call(drag(simulation))
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  // 노드 라벨 추가
  const label = g.append('g')
    .selectAll('text')
    .data(nodes)
    .enter()
    .append('text')
    .attr('class', 'node-label')
    .attr('dx', d => d.radius + 5)
    .attr('dy', 4)
    .text(d => {
      if (d.type === 'anchor' && d.slot) {
        return `Slot ${d.slot}`;
      }
      return d.content.substring(0, 20) + (d.content.length > 20 ? '...' : '');
    })
    .style('font-size', '12px')
    .style('fill', palette.labelFill)
    .style('pointer-events', 'none');

  // Tooltip 추가
  node.append('title')
    .text(d => {
      if (d.type === 'anchor') {
        return `Anchor ${d.slot}\n${d.content}`;
      }
      return `Memory\n${d.content}\nHop: ${d.hop_distance || 'N/A'}`;
    });

  // Force simulation 업데이트
  simulation.nodes(nodes).on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    label
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });

  simulation.force('link').links(links);
  simulation.alpha(1).restart();
}

/**
 * Hop 거리에 따른 원형 레이어 배치
 */
function layoutNodesByHop() {
  const width = svg.attr('width');
  const height = svg.attr('height');
  const centerX = width / 2;
  const centerY = height / 2;

  // 앵커 노드 찾기
  const anchorNodes = nodes.filter(n => n.type === 'anchor');
  
  anchorNodes.forEach((anchor, anchorIndex) => {
    // 각 앵커를 중심으로 배치
    const angle = (anchorIndex / anchorNodes.length) * 2 * Math.PI;
    const radius = 150;
    anchor.fx = centerX + Math.cos(angle) * radius;
    anchor.fy = centerY + Math.sin(angle) * radius;

    // 해당 앵커와 연결된 메모리들을 hop 거리별로 원형 레이어에 배치
    const relatedMemories = nodes.filter(n => 
      n.type === 'memory' && 
      links.some(l => 
        (l.source.id === anchor.id && l.target.id === n.id) ||
        (l.target.id === anchor.id && l.source.id === n.id)
      )
    );

    relatedMemories.forEach((memory, memIndex) => {
      const hop = memory.hop_distance || 1;
      const layerRadius = 100 + (hop - 1) * 80;
      const memAngle = (memIndex / relatedMemories.length) * 2 * Math.PI + angle;
      
      memory.fx = anchor.fx + Math.cos(memAngle) * layerRadius;
      memory.fy = anchor.fy + Math.sin(memAngle) * layerRadius;
    });
  });

  // 연결되지 않은 메모리들은 자유롭게 배치
  nodes.forEach(node => {
    if (!node.fx && !node.fy && node.type === 'memory') {
      node.fx = null;
      node.fy = null;
    }
  });
}

/**
 * 노드 드래그 핸들러
 */
function drag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}

/**
 * 노드 선택
 */
function selectNode(node) {
  
  // 노드 하이라이트
  svg.selectAll('.node')
    .classed('selected', d => d.id === node.id);
  
  // 메모리 상세 정보 표시
  displayMemoryDetails(node);
}

/**
 * 메모리 상세 정보 표시
 */
function displayMemoryDetails(node) {
  const detailsContainer = document.getElementById('memory-details');
  
  if (node.type === 'anchor') {
    const slot = escapeHtml(node.slot);
    const id = escapeHtml(node.id);
    const content = escapeHtml(node.content);
    const importance = escapeHtml(node.importance != null ? node.importance : 'N/A');
    const created = node.created_at ? escapeHtml(new Date(node.created_at).toLocaleString()) : 'N/A';
    detailsContainer.innerHTML = `
      <div class="memory-detail-item">
        <label>Type:</label>
        <div class="value">Anchor (Slot ${slot})</div>
      </div>
      <div class="memory-detail-item">
        <label>Memory ID:</label>
        <div class="value">${id}</div>
      </div>
      <div class="memory-detail-item">
        <label>Content:</label>
        <div class="value">${content}</div>
      </div>
      <div class="memory-detail-item">
        <label>Hop Distance:</label>
        <div class="value">0 (Anchor)</div>
      </div>
      <div class="memory-detail-item">
        <label>Similarity:</label>
        <div class="value">1.0 (100.0%)</div>
      </div>
      <div class="memory-detail-item">
        <label>Importance:</label>
        <div class="value">${importance}</div>
      </div>
      <div class="memory-detail-item">
        <label>Created:</label>
        <div class="value">${created}</div>
      </div>
      <button type="button" class="anchor-change-btn js-change-anchor m-button m-button--primary" data-slot="${slot}">
        Change Anchor
      </button>
    `;
  } else {
    const id = escapeHtml(node.id);
    const content = escapeHtml(node.content);
    const hopDistance = escapeHtml(node.hop_distance != null ? node.hop_distance : 'N/A');
    const similarity = node.similarity != null ? escapeHtml((node.similarity * 100).toFixed(1) + '%') : 'N/A';
    const importance = escapeHtml(node.importance != null ? node.importance : 'N/A');
    const created = node.created_at ? escapeHtml(new Date(node.created_at).toLocaleString()) : 'N/A';
    detailsContainer.innerHTML = `
      <div class="memory-detail-item">
        <label>Type:</label>
        <div class="value">Memory</div>
      </div>
      <div class="memory-detail-item">
        <label>Memory ID:</label>
        <div class="value">${id}</div>
      </div>
      <div class="memory-detail-item">
        <label>Content:</label>
        <div class="value">${content}</div>
      </div>
      <div class="memory-detail-item">
        <label>Hop Distance:</label>
        <div class="value">${hopDistance}</div>
      </div>
      <div class="memory-detail-item">
        <label>Similarity:</label>
        <div class="value">${similarity}</div>
      </div>
      <div class="memory-detail-item">
        <label>Importance:</label>
        <div class="value">${importance}</div>
      </div>
      <div class="memory-detail-item">
        <label>Created:</label>
        <div class="value">${created}</div>
      </div>
    `;
  }
}

/**
 * 앵커 목록 업데이트
 */
function updateAnchorList() {
  const anchorListContainer = document.getElementById('anchor-list');
  
  if (!mapData || !mapData.anchors || mapData.anchors.length === 0) {
    anchorListContainer.innerHTML = '<p class="no-data">No anchors set</p>';
    return;
  }

  anchorListContainer.innerHTML = mapData.anchors
    .map(anchor => {
      if (!anchor.memory_id) return '';
      const memory = mapData.nodes.find(n => n.id === anchor.memory_id);
      const slot = escapeHtml(anchor.slot);
      const slotClass = /^[ABC]$/i.test(anchor.slot) ? slot.toLowerCase() : 'a';
      const memoryId = escapeHtml(anchor.memory_id);
      const contentPreview = memory ? escapeHtml(memory.content.substring(0, 50)) + '...' : '';
      return `
        <div class="anchor-item slot-${slotClass} js-select-anchor" data-memory-id="${memoryId}">
          <div class="slot-label">Slot ${slot}</div>
          <div class="memory-id">${memoryId}</div>
          ${memory ? `<div class="anchor-item-preview">${contentPreview}</div>` : ''}
        </div>
      `;
    })
    .join('');
}

/**
 * 앵커 노드 선택
 */
function selectAnchorNode(memoryId) {
  if (!Array.isArray(nodes)) {
    return;
  }
  const node = nodes.find(n => n.id === memoryId);
  if (node) {
    selectNode(node);
    
    // 맵에서 해당 노드로 이동 (노드가 보이도록 확대 및 이동)
    const width = svg.attr('width');
    const height = svg.attr('height');
    if (node.x && node.y) {
      const transform = d3.zoomIdentity
        .translate(parseFloat(width) / 2 - node.x, parseFloat(height) / 2 - node.y)
        .scale(2);
      svg.transition().duration(750).call(
        svg.node().dispatchEvent,
        new CustomEvent('zoom', { detail: { transform } })
      );
    }
  }
}

/**
 * 앵커 변경 (향후 구현)
 */
function changeAnchor(slot) {
  // TODO: 앵커 변경 UI 구현
  alert(`앵커 변경 기능은 향후 구현 예정입니다. Slot: ${slot}`);
}

/**
 * 검색 수행
 */
async function performSearch() {
  const query = document.getElementById('search-query-input').value.trim();
  const slotSelect = document.getElementById('search-slot-select');
  const slot = slotSelect ? slotSelect.value : 'A'; // 기본값: A
  const agentId = document.getElementById('agent-id-input').value || 'default';
  
  if (!query) {
    alert('검색어를 입력해주세요.');
    return;
  }
  
  // slot이 필수이므로 반드시 설정
  if (!slot || !['A', 'B', 'C'].includes(slot)) {
    alert('슬롯을 선택해주세요. (A, B, C 중 하나)');
    return;
  }
  
  try {
    // search_local 도구 호출
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const response = await fetchFn(`/tools/search_local`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: query,
        slot: slot, // 필수 파라미터
        agent_id: agentId,
        limit: 100
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    searchResults = result.result || result;
    
    // 검색 결과 하이라이트
    highlightSearchResults();
    
    // 검색 결과 요약 표시
    const resultCount = searchResults.items ? searchResults.items.length : 0;
    debugAnchorMap('search-complete', { resultCount });
    
  } catch (error) {
    debugAnchorMap('search-error', { message: error.message });
    alert(`검색 중 오류가 발생했습니다: ${error.message}`);
  }
}

/**
 * 검색 결과 하이라이트
 */
function highlightSearchResults() {
  if (!searchResults || !searchResults.items) {
    return;
  }
  
  // 하이라이트할 노드 ID 수집
  highlightedNodeIds.clear();
  searchResults.items.forEach(item => {
    highlightedNodeIds.add(item.id);
  });
  
  // 노드 스타일 업데이트
  updateNodeHighlight();
  
  // 검색 결과가 있는 경우 첫 번째 결과로 이동 (맵 노드 배열이 준비된 경우에만 줌/선택)
  if (searchResults.items.length > 0) {
    const firstResult = searchResults.items[0];
    if (Array.isArray(nodes)) {
      const node = nodes.find(n => n.id === firstResult.id);
      if (node) {
        selectNode(node);
        // 노드가 보이도록 확대 및 이동
        const width = svg.attr('width');
        const height = svg.attr('height');
        if (node.x && node.y) {
          const transform = d3.zoomIdentity
            .translate(parseFloat(width) / 2 - node.x, parseFloat(height) / 2 - node.y)
            .scale(1.5);
          svg.transition().duration(750).call(
            svg.node().dispatchEvent,
            new CustomEvent('zoom', { detail: { transform } })
          );
        }
      }
    }
  }
}

/**
 * 노드 하이라이트 업데이트
 */
function updateNodeHighlight() {
  const nodeElements = svg.selectAll('.node');
  
  nodeElements
    .classed('highlighted', d => highlightedNodeIds.has(d.id))
    .attr('stroke-width', d => {
      if (highlightedNodeIds.has(d.id)) {
        return d.type === 'anchor' ? 5 : 4; // 하이라이트된 노드는 더 두꺼운 테두리
      }
      return d.type === 'anchor' ? 3 : 2;
    })
    .attr('opacity', d => {
      // 하이라이트되지 않은 노드는 약간 투명하게
      if (highlightedNodeIds.size > 0 && !highlightedNodeIds.has(d.id)) {
        return 0.3;
      }
      return 1.0;
    });
  
  // 링크도 하이라이트 (검색 결과와 연결된 링크)
  const linkElements = svg.selectAll('.link');
  linkElements
    .attr('opacity', d => {
      if (highlightedNodeIds.size > 0) {
        const sourceHighlighted = highlightedNodeIds.has(d.source.id || d.source);
        const targetHighlighted = highlightedNodeIds.has(d.target.id || d.target);
        if (sourceHighlighted || targetHighlighted) {
          return 1.0;
        }
        return 0.2;
      }
      return 0.6;
    })
    .attr('stroke-width', d => {
      if (highlightedNodeIds.size > 0) {
        const sourceHighlighted = highlightedNodeIds.has(d.source.id || d.source);
        const targetHighlighted = highlightedNodeIds.has(d.target.id || d.target);
        if (sourceHighlighted && targetHighlighted) {
          return 3;
        } else if (sourceHighlighted || targetHighlighted) {
          return 2;
        }
      }
      return d.type === 'hop' ? 2 : 1.5;
    });
  
  // 라벨도 하이라이트
  const labelElements = svg.selectAll('.node-label');
  labelElements
    .style('font-weight', d => highlightedNodeIds.has(d.id) ? 'bold' : 'normal')
    .style('font-size', d => highlightedNodeIds.has(d.id) ? '14px' : '12px');
}

/**
 * 검색 하이라이트 제거
 */
function clearSearch() {
  searchResults = null;
  highlightedNodeIds.clear();
  document.getElementById('search-query-input').value = '';
  document.getElementById('search-slot-select').value = '';
  
  // 노드 스타일 복원
  updateNodeHighlight();
  
  debugAnchorMap('search-cleared');
}

/**
 * 자동 새로고침 시작
 */
function startAutoRefresh() {
  stopAutoRefresh(); // 기존 인터벌 정리
  
  const interval = parseInt(document.getElementById('refresh-interval-select').value, 10);
  autoRefreshInterval = setInterval(() => {
    loadMapData();
  }, interval);
  
  debugAnchorMap('auto-refresh-started', { intervalMs: interval });
}

/**
 * 자동 새로고침 중지
 */
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    debugAnchorMap('auto-refresh-stopped');
  }
}

/**
 * WebSocket 연결 시도
 */
function tryConnectWebSocket() {
  // WebSocket이 지원되는 경우에만 시도
  if (typeof WebSocket === 'undefined') {
    debugAnchorMap('websocket-unsupported');
    return;
  }
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  try {
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      debugAnchorMap('websocket-open');
      // WebSocket으로 Anchor Map 업데이트 구독 요청
      const agentId = document.getElementById('agent-id-input').value || 'default';
      websocket.send(JSON.stringify({
        method: 'subscribe',
        params: {
          type: 'anchor_map_updates',
          agent_id: agentId
        }
      }));
    };
    
    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'anchor_map_update') {
          // Anchor Map 업데이트 수신
          debugAnchorMap('websocket-update', { hasData: Boolean(message.data) });
          if (message.data) {
            mapData = message.data;
            renderMap();
            updateAnchorList();
          }
        } else if (message.type === 'ping') {
          // Keep-alive ping 응답
          websocket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        debugAnchorMap('websocket-parse-error', { message: error.message });
      }
    };
    
    websocket.onerror = (error) => {
      debugAnchorMap('websocket-error', { type: error?.type ?? 'unknown' });
      // WebSocket 실패 시 polling으로 fallback
      if (!autoRefreshInterval && document.getElementById('auto-refresh-toggle').checked) {
        startAutoRefresh();
      }
    };
    
    websocket.onclose = () => {
      debugAnchorMap('websocket-closed');
      websocket = null;
      
      // 자동 재연결 시도 (5초 후)
      if (document.getElementById('auto-refresh-toggle').checked) {
        setTimeout(() => {
          if (!websocket) {
            tryConnectWebSocket();
          }
        }, 5000);
      }
    };
  } catch (error) {
    debugAnchorMap('websocket-connect-failed', { message: error.message });
    // WebSocket 실패 시 polling으로 fallback
    if (!autoRefreshInterval && document.getElementById('auto-refresh-toggle').checked) {
      startAutoRefresh();
    }
  }
}

/**
 * WebSocket 연결 종료
 */
function disconnectWebSocket() {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
}

// Agent ID 변경 시 WebSocket 재구독
document.addEventListener('DOMContentLoaded', () => {
  const agentIdInput = document.getElementById('agent-id-input');
  if (agentIdInput) {
    agentIdInput.addEventListener('change', () => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        const agentId = agentIdInput.value || 'default';
        websocket.send(JSON.stringify({
          method: 'subscribe',
          params: {
            type: 'anchor_map_updates',
            agent_id: agentId
          }
        }));
      }
    });
  }
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
  disconnectWebSocket();
});

// 전역 함수로 노출 (HTML에서 호출 가능)
window.selectAnchorNode = selectAnchorNode;
window.changeAnchor = changeAnchor;

