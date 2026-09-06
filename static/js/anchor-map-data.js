/**
 * Anchor Map — data fetching: map data and agent ID options.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_ANCHOR_MAP__;
  if (!ns) return;

  const state = ns.state;

  function getSelectedAgentId() {
    const select = document.getElementById('agent-id-select');
    return (select && select.value) || 'default';
  }

  async function loadAgentIdOptions() {
    const select = document.getElementById('agent-id-select');
    if (!select) return;

    const previousSelection = getSelectedAgentId();

    try {
      const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
      const response = await fetchFn('/api/anchors/agents');
      if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

      const payload = await response.json();
      const agents = Array.isArray(payload.agents) ? payload.agents : [];
      select.innerHTML = '';

      if (agents.length === 0) {
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'default (앵커 없음)';
        select.appendChild(option);
      } else {
        for (const entry of agents) {
          const option = document.createElement('option');
          option.value = entry.agent_id;
          option.textContent = entry.agent_id + ' (' + entry.anchor_count + ' anchors)';
          select.appendChild(option);
        }
      }

      const validValues = Array.from(select.options).map(function (o) { return o.value; });
      if (validValues.includes(previousSelection)) {
        select.value = previousSelection;
      } else if (agents.length > 0) {
        select.value = agents[0].agent_id;
      } else {
        select.value = 'default';
      }
    } catch (error) {
      ns.debugAnchorMap('agent-list-load-error', { message: error.message });
      if (select.options.length === 0) {
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'default (앵커 없음)';
        select.appendChild(option);
        select.value = 'default';
      }
    }
  }

  /**
   * 서버가 요청마다 새로 만드는 timestamp 를 비교에 넣으면 hasChanged 가 항상 true 가 되어
   * map-unchanged 분기는 도달 불가능한 죽은 코드가 되고, 데이터가 그대로여도 매 주기 전체
   * 재렌더가 돈다. 내용(anchors/nodes/links)만 비교한다 (issue 870).
   */
  function hasMapDataChanged(previous, next) {
    if (!previous || !next) return true;
    return JSON.stringify(previous.anchors) !== JSON.stringify(next.anchors) ||
      JSON.stringify(previous.nodes) !== JSON.stringify(next.nodes) ||
      JSON.stringify(previous.links) !== JSON.stringify(next.links);
  }

  async function loadMapData(options) {
    // 클릭 핸들러로도 직접 쓰이므로(Event 객체가 넘어온다) 재시도 여부는 true 인지로만 판단한다.
    const isSnapbackRetry = options === true;
    const agentId = getSelectedAgentId();

    try {
      const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
      const response = await fetchFn('/api/anchors/map?agent_id=' + encodeURIComponent(agentId));
      if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

      const newMapData = ns.normalizeMapData(await response.json());
      const hasChanged = hasMapDataChanged(state.mapData, newMapData);

      if (hasChanged) {
        state.mapData = newMapData;
        ns.renderMap();
        ns.updateAnchorList();
        ns.debugAnchorMap('map-updated', { timestamp: newMapData.timestamp });
      } else {
        ns.debugAnchorMap('map-unchanged');
      }

      await loadAgentIdOptions();

      // 셀렉터가 유효 목록에 없는 값을 default 등으로 스냅백하면 "화면은 A 를 가리키는데
      // 그려진 건 B" 가 된다. 스냅백된 값으로 한 번만 다시 불러온다 (issue 872).
      if (!isSnapbackRetry && getSelectedAgentId() !== agentId) {
        await loadMapData(true);
      }
    } catch (error) {
      ns.debugAnchorMap('load-error', { message: error.message });
      if (!state.autoRefreshInterval) {
        alert('맵 데이터를 불러올 수 없습니다: ' + error.message);
      }
    }
  }

  ns.hasMapDataChanged = hasMapDataChanged;
  ns.getSelectedAgentId = getSelectedAgentId;
  ns.loadAgentIdOptions = loadAgentIdOptions;
  ns.loadMapData = loadMapData;

})(typeof window !== 'undefined' ? window : globalThis);
