/**
 * Neighbor focus shared by the memory graph and the anchor map.
 */
(function (global) {
  'use strict';

  function endpointId(endpoint) {
    if (endpoint && typeof endpoint === 'object') {
      return endpoint.id;
    }
    return endpoint;
  }

  function collectKeepIds(focusId, edges) {
    const keepIds = new Set();
    if (focusId != null) {
      keepIds.add(focusId);
    }
    const list = Array.isArray(edges) ? edges : [];
    for (const edge of list) {
      const sourceId = endpointId(edge.source);
      const targetId = endpointId(edge.target);
      if (sourceId === focusId) {
        keepIds.add(targetId);
      } else if (targetId === focusId) {
        keepIds.add(sourceId);
      }
    }
    return keepIds;
  }

  function edgeTouchesKeep(edge, keepIds) {
    return keepIds.has(endpointId(edge.source)) && keepIds.has(endpointId(edge.target));
  }

  global.__MEMENTO_NEIGHBOR_FOCUS__ = {
    endpointId,
    collectKeepIds,
    edgeTouchesKeep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
