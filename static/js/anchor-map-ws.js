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
        // 형태가 깨진 push 를 그대로 넣으면 normalizeMapData 가 nodes 를 [] 로 보정해
        // "앵커가 없습니다"(빈 상태)로 그려진다 — 데이터 이상은 오류로 보여야 한다 (issue 949).
        if (!ns.isMapDataShapeValid(message.data)) {
          ns.debugAnchorMap('websocket-invalid-payload', { hasData: Boolean(message.data) });
          ns.setMapStatusMessage('error', '실시간 맵 갱신 데이터가 올바르지 않습니다 — Refresh 로 다시 불러오세요');
          return;
        }
        state.mapData = ns.normalizeMapData(message.data);
        ns.renderMap();
        ns.updateAnchorList();
      } else if (message.type === 'ping') {
        state.websocket.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      ns.debugAnchorMap('websocket-parse-error', { message: error.message });
      ns.setMapStatusMessage('error', '실시간 맵 갱신을 처리하지 못했습니다 — ' + error.message);
    }
  }

  function fallbackToPolling() {
    const toggle = document.getElementById('auto-refresh-toggle');
    if (!state.autoRefreshInterval && toggle && toggle.checked) {
      startAutoRefresh();
      return;
    }
    if (state.autoRefreshInterval) return;   // 이미 폴링이 돌고 있으면 사용자 영향 없음
    // 실시간도 폴링도 없다 — 이 화면은 이제 스스로 갱신되지 않는다 (issue 904)
    ns.setMapStatusMessage('error', '실시간 갱신이 끊겼습니다 — Refresh 로 다시 불러오세요');
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
  // Exposed for unit tests that exercise failure branches directly (issue 904).
  ns.handleWsMessage = handleWsMessage;
  ns.fallbackToPolling = fallbackToPolling;

})(typeof window !== 'undefined' ? window : globalThis);
