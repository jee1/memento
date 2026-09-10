/**
 * Anchor Map — layout merge and localStorage persistence (issue 894).
 * Pure helpers: no DOM / d3. Safe to load under node:vm / new Function in vitest.
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_ANCHOR_MAP__ = global.__MEMENTO_ANCHOR_MAP__ || {});

  ns.LAYOUT_STORAGE_KEY = 'memento.anchorMap.layout.v1';
  ns.LAYOUT_SCHEMA_VERSION = 1;
  ns.LAYOUT_MAX_AGENTS = 5;
  ns.LAYOUT_MAX_NODES_PER_AGENT = 300;
  ns.LAYOUT_MAX_BYTES = 262144; // 256KB
  ns.LAYOUT_HOP_DISTANCE = { 1: 90, 2: 170, 3: 250 };
  ns.LAYOUT_DEFAULT_DISTANCE = 100;

  function emptyDoc() {
    return { version: ns.LAYOUT_SCHEMA_VERSION, agents: {} };
  }

  function safeGetItem(storage, key) {
    try {
      return storage.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function roundCoord(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  ns.hopLinkDistance = function hopLinkDistance(link) {
    const hop = link && (link.hop_distance != null
      ? link.hop_distance
      : (link.target && link.target.hop_distance));
    return ns.LAYOUT_HOP_DISTANCE[hop] || ns.LAYOUT_DEFAULT_DISTANCE;
  };

  /**
   * Merge server payload with live geometry and stored pins.
   * Priority: previousNodes (memory) > storedNodes > none (auto seed later).
   * Server fields always come from nextRawNodes.
   */
  ns.mergeNodeLayout = function mergeNodeLayout(nextRawNodes, previousNodes, storedNodes) {
    const prevById = new Map((previousNodes || []).map(function (n) { return [n.id, n]; }));
    const stored = storedNodes || {};
    const nodes = (nextRawNodes || []).map(function (raw) {
      const merged = Object.assign({}, raw);
      const prev = prevById.get(raw.id);
      if (prev) {
        merged.x = prev.x;
        merged.y = prev.y;
        merged.vx = prev.vx;
        merged.vy = prev.vy;
        merged.fx = prev.fx;
        merged.fy = prev.fy;
        merged.pinned = Boolean(prev.pinned);
        return merged;
      }
      const saved = stored[raw.id];
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        merged.x = saved.x;
        merged.y = saved.y;
        merged.pinned = Boolean(saved.pinned);
        if (merged.pinned) {
          merged.fx = saved.x;
          merged.fy = saved.y;
        }
      }
      return merged;
    });
    const liveIds = new Set(nodes.map(function (n) { return n.id; }));
    const removedIds = Array.from(new Set(
      Array.from(prevById.keys()).concat(Object.keys(stored))
    )).filter(function (id) { return !liveIds.has(id); });
    return { nodes: nodes, removedIds: removedIds };
  };

  ns.readStoredLayout = function readStoredLayout(storage) {
    try {
      const raw = safeGetItem(storage, ns.LAYOUT_STORAGE_KEY);
      if (raw == null || raw === '') return emptyDoc();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyDoc();
      if (parsed.version !== ns.LAYOUT_SCHEMA_VERSION) return emptyDoc();
      if (!parsed.agents || typeof parsed.agents !== 'object' || Array.isArray(parsed.agents)) {
        return emptyDoc();
      }
      return { version: ns.LAYOUT_SCHEMA_VERSION, agents: parsed.agents };
    } catch (_err) {
      return emptyDoc();
    }
  };

  ns.readAgentLayout = function readAgentLayout(storage, agentId) {
    const doc = ns.readStoredLayout(storage);
    const entry = doc.agents[agentId];
    if (!entry || !entry.nodes || typeof entry.nodes !== 'object') return {};
    return entry.nodes;
  };

  ns.buildAgentEntry = function buildAgentEntry(pinnedNodes, now) {
    const nodes = {};
    (pinnedNodes || []).forEach(function (n) {
      if (!n || !n.id || !n.pinned) return;
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      nodes[n.id] = {
        x: roundCoord(n.x),
        y: roundCoord(n.y),
        pinned: true,
      };
    });
    return { updated_at: now || Date.now(), nodes: nodes };
  };

  ns.pruneAgentNodes = function pruneAgentNodes(entry, liveIds) {
    if (!entry || !entry.nodes) return entry;
    const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
    const nextNodes = {};
    Object.keys(entry.nodes).forEach(function (id) {
      if (live.has(id)) nextNodes[id] = entry.nodes[id];
    });
    return { updated_at: entry.updated_at, nodes: nextNodes };
  };

  function trimAgentNodes(entry, maxNodes) {
    const ids = Object.keys(entry.nodes || {});
    if (ids.length <= maxNodes) return entry;
    const keep = ids.slice(ids.length - maxNodes);
    const nextNodes = {};
    keep.forEach(function (id) { nextNodes[id] = entry.nodes[id]; });
    const dropped = ids.length - keep.length;
    if (typeof ns.debugAnchorMap === 'function') {
      ns.debugAnchorMap('layout-cap-trimmed', { dropped: dropped });
    }
    return { updated_at: entry.updated_at, nodes: nextNodes };
  }

  function agentUpdatedAt(entry) {
    return (entry && typeof entry.updated_at === 'number') ? entry.updated_at : 0;
  }

  function evictOldestAgents(doc, currentAgentId, maxAgents) {
    const ids = Object.keys(doc.agents || {});
    if (ids.length <= maxAgents) return doc;
    const sortable = ids
      .filter(function (id) { return id !== currentAgentId; })
      .sort(function (a, b) {
        return agentUpdatedAt(doc.agents[a]) - agentUpdatedAt(doc.agents[b]);
      });
    while (Object.keys(doc.agents).length > maxAgents && sortable.length) {
      const victim = sortable.shift();
      delete doc.agents[victim];
    }
    return doc;
  }

  ns.enforceLayoutCaps = function enforceLayoutCaps(doc, currentAgentId) {
    const next = { version: ns.LAYOUT_SCHEMA_VERSION, agents: Object.assign({}, doc.agents || {}) };
    Object.keys(next.agents).forEach(function (agentId) {
      next.agents[agentId] = trimAgentNodes(
        next.agents[agentId],
        ns.LAYOUT_MAX_NODES_PER_AGENT
      );
    });
    evictOldestAgents(next, currentAgentId, ns.LAYOUT_MAX_AGENTS);

    let serialized = JSON.stringify(next);
    if (serialized.length <= ns.LAYOUT_MAX_BYTES) return next;

    evictOldestAgents(next, currentAgentId, 1);
    if (next.agents[currentAgentId]) {
      next.agents[currentAgentId] = trimAgentNodes(
        next.agents[currentAgentId],
        Math.max(1, Math.floor(ns.LAYOUT_MAX_NODES_PER_AGENT / 2))
      );
    }
    serialized = JSON.stringify(next);
    if (serialized.length > ns.LAYOUT_MAX_BYTES && next.agents[currentAgentId]) {
      let limit = Math.floor(ns.LAYOUT_MAX_NODES_PER_AGENT / 2);
      while (JSON.stringify(next).length > ns.LAYOUT_MAX_BYTES && limit > 1) {
        limit = Math.floor(limit / 2);
        next.agents[currentAgentId] = trimAgentNodes(next.agents[currentAgentId], limit);
      }
    }
    return next;
  };

  function trySetItem(storage, key, value) {
    storage.setItem(key, value);
  }

  ns.writeAgentLayout = function writeAgentLayout(storage, agentId, pinnedNodes) {
    try {
      const doc = ns.readStoredLayout(storage);
      doc.agents[agentId] = ns.buildAgentEntry(pinnedNodes, Date.now());
      const capped = ns.enforceLayoutCaps(doc, agentId);
      const payload = JSON.stringify(capped);
      try {
        trySetItem(storage, ns.LAYOUT_STORAGE_KEY, payload);
        return { ok: true };
      } catch (firstErr) {
        const reasonName = firstErr && firstErr.name;
        const isQuota = reasonName === 'QuotaExceededError' ||
          (firstErr && /quota/i.test(String(firstErr.message || '')));
        // Drop other agents once and retry
        const retryDoc = {
          version: ns.LAYOUT_SCHEMA_VERSION,
          agents: {},
        };
        if (capped.agents[agentId]) retryDoc.agents[agentId] = capped.agents[agentId];
        try {
          trySetItem(storage, ns.LAYOUT_STORAGE_KEY, JSON.stringify(retryDoc));
          return { ok: true };
        } catch (secondErr) {
          if (typeof ns.debugAnchorMap === 'function') {
            ns.debugAnchorMap('layout-persist-disabled', {
              reason: isQuota ? 'quota' : 'unavailable',
            });
          }
          return { ok: false, reason: isQuota ? 'quota' : 'unavailable' };
        }
      }
    } catch (_err) {
      if (typeof ns.debugAnchorMap === 'function') {
        ns.debugAnchorMap('layout-persist-disabled', { reason: 'unavailable' });
      }
      return { ok: false, reason: 'unavailable' };
    }
  };

  ns.pruneStoredNodes = function pruneStoredNodes(storage, agentId, liveIds) {
    try {
      const doc = ns.readStoredLayout(storage);
      if (!doc.agents[agentId]) return { ok: true };
      doc.agents[agentId] = ns.pruneAgentNodes(doc.agents[agentId], liveIds);
      const capped = ns.enforceLayoutCaps(doc, agentId);
      trySetItem(storage, ns.LAYOUT_STORAGE_KEY, JSON.stringify(capped));
      return { ok: true };
    } catch (_err) {
      return { ok: false, reason: 'unavailable' };
    }
  };

  ns.clearAgentLayout = function clearAgentLayout(storage, agentId) {
    try {
      const doc = ns.readStoredLayout(storage);
      if (doc.agents[agentId]) {
        delete doc.agents[agentId];
        trySetItem(storage, ns.LAYOUT_STORAGE_KEY, JSON.stringify(doc));
      }
      return { ok: true };
    } catch (_err) {
      return { ok: false, reason: 'unavailable' };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
