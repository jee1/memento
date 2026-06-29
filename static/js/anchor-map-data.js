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

  async function loadMapData() {
    const agentId = getSelectedAgentId();

    try {
      const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
      const response = await fetchFn('/api/anchors/map?agent_id=' + encodeURIComponent(agentId));
      if (!response.ok) throw new Error('HTTP error! status: ' + response.status);

      const newMapData = ns.normalizeMapData(await response.json());
      const hasChanged = !state.mapData ||
        JSON.stringify(state.mapData.timestamp) !== JSON.stringify(newMapData.timestamp) ||
        JSON.stringify(state.mapData.anchors) !== JSON.stringify(newMapData.anchors) ||
        state.mapData.nodes.length !== newMapData.nodes.length ||
        state.mapData.links.length !== newMapData.links.length;

      if (hasChanged) {
        state.mapData = newMapData;
        ns.renderMap();
        ns.updateAnchorList();
        ns.debugAnchorMap('map-updated', { timestamp: newMapData.timestamp });
      } else {
        ns.debugAnchorMap('map-unchanged');
      }

      await loadAgentIdOptions();
    } catch (error) {
      ns.debugAnchorMap('load-error', { message: error.message });
      if (!state.autoRefreshInterval) {
        alert('맵 데이터를 불러올 수 없습니다: ' + error.message);
      }
    }
  }

  ns.getSelectedAgentId = getSelectedAgentId;
  ns.loadAgentIdOptions = loadAgentIdOptions;
  ns.loadMapData = loadMapData;

})(typeof window !== 'undefined' ? window : globalThis);
