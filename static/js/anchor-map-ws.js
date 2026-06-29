/**
 * Anchor Map — WebSocket connection and auto-refresh polling.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_ANCHOR_MAP__;
  if (!ns) return;

  const state = ns.state;

  function startAutoRefresh() {
    stopAutoRefresh();
    const intervalSelect = document.getElementById('refresh-interval-select');
    const interval = parseInt(intervalSelect ? intervalSelect.value : '30000', 10);
    state.autoRefreshInterval = setInterval(function () { ns.loadMapData(); }, interval);
    ns.debugAnchorMap('auto-refresh-started', { intervalMs: interval });
  }

  function stopAutoRefresh() {
    if (state.autoRefreshInterval) {
      clearInterval(state.autoRefreshInterval);
      state.autoRefreshInterval = null;
      ns.debugAnchorMap('auto-refresh-stopped');
    }
  }

  function resubscribeWebSocket() {
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
      state.websocket.send(JSON.stringify({
        method: 'subscribe',
        params: { type: 'anchor_map_updates', agent_id: ns.getSelectedAgentId() },
      }));
    }
  }

  function disconnectWebSocket() {
    if (state.websocket) {
      state.websocket.close();
      state.websocket = null;
    }
  }

  function handleWsMessage(event) {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'anchor_map_update') {
        ns.debugAnchorMap('websocket-update', { hasData: Boolean(message.data) });
        if (message.data) {
          state.mapData = message.data;
          ns.renderMap();
          ns.updateAnchorList();
        }
      } else if (message.type === 'ping') {
        state.websocket.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      ns.debugAnchorMap('websocket-parse-error', { message: error.message });
    }
  }

  function fallbackToPolling() {
    const toggle = document.getElementById('auto-refresh-toggle');
    if (!state.autoRefreshInterval && toggle && toggle.checked) {
      startAutoRefresh();
    }
  }

  function tryConnectWebSocket() {
    if (typeof WebSocket === 'undefined') {
      ns.debugAnchorMap('websocket-unsupported');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host;

    try {
      state.websocket = new WebSocket(wsUrl);
      state.websocket.onopen = function () {
        ns.debugAnchorMap('websocket-open');
        resubscribeWebSocket();
      };
      state.websocket.onmessage = handleWsMessage;
      state.websocket.onerror = function (error) {
        ns.debugAnchorMap('websocket-error', { type: (error && error.type) || 'unknown' });
        fallbackToPolling();
      };
      state.websocket.onclose = function () {
        ns.debugAnchorMap('websocket-closed');
        state.websocket = null;
        const toggle = document.getElementById('auto-refresh-toggle');
        if (toggle && toggle.checked) {
          setTimeout(function () { if (!state.websocket) tryConnectWebSocket(); }, 5000);
        }
      };
    } catch (error) {
      ns.debugAnchorMap('websocket-connect-failed', { message: error.message });
      fallbackToPolling();
    }
  }

  ns.startAutoRefresh = startAutoRefresh;
  ns.stopAutoRefresh = stopAutoRefresh;
  ns.tryConnectWebSocket = tryConnectWebSocket;
  ns.resubscribeWebSocket = resubscribeWebSocket;
  ns.disconnectWebSocket = disconnectWebSocket;

})(typeof window !== 'undefined' ? window : globalThis);
