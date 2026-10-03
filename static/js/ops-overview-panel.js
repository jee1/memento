/**
 * Ops overview tab (#1145) — reads existing admin endpoints only; no polling.
 */
(function (global) {
  'use strict';

  // Korean UI strings (#1145). Code references S.* only; edit text here, not in the logic below.
  const S = {
    loading: '불러오는 중…',
    loadError: function (message) { return '불러오지 못했습니다 — ' + message; },
    tileReview: '검토 대기',
    tileReviewNote: '최근 1시간 순유입',
    tileBatch: '배치 실패',
    tileBatchNote: function (windowDays, durationHuman) { return '최근 ' + windowDays + '일 · 영향 ' + durationHuman; },
    tileEmbedding: '임베딩 결손률',
    tileEmbeddingNote: function (problems, total) { return '결손 ' + problems + '건 / 활성 ' + total + '건'; },
    tileMemory: '기억 총계',
    typeBarLabel: function (parts) { return '기억 유형 구성: ' + parts; },
    anchorEmpty: '슬롯 A 에 설정된 앵커가 없습니다.',
    anchorAgent: function (agentId) { return 'Agent ' + agentId + ' · 슬롯 A'; },
    anchorHops: function (h1, h2, h3) { return '1-hop ' + h1 + '개 · 2-hop ' + h2 + '개 · 3-hop ' + h3 + '개'; },
    reviewEmpty: '검토 대기 중인 후보가 없습니다.',
    severityOverdue: '기한 지남',
    severitySoon: '24시간 내',
    severityLater: '대기',
    jobsEmpty: '등록된 배치 작업이 없습니다.',
    jobRunning: '실행 중',
    jobPaused: '일시정지',
    jobErrors: function (n) { return '오류 ' + n + '건'; },
    jobOk: '정상',
    nextRun: function (text) { return '다음 실행 ' + text; },
    elapsed: function (ms) {
      const min = Math.floor(ms / 60000);
      if (!(min >= 1)) return '방금';
      if (min < 60) return min + '분 전';
      const hours = Math.floor(min / 60);
      if (hours < 24) return hours + '시간 전';
      return Math.floor(hours / 24) + '일 전';
    },
  };

  let refreshGeneration = 0;
  let wired = false;

  // The route only accepts page_size 25 or 50; the card shows the first 5.
  const REVIEW_URL = '/admin/memory/review-candidates?status=pending&page_size=25&page=1';

  function reviewSeverity(dueAt, nowMs) {
    if (!dueAt) return 'idle';
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return 'idle';
    if (due <= nowMs) return 'crit';
    if (due - nowMs <= 24 * 60 * 60 * 1000) return 'warn';
    return 'idle';
  }

  function severityLabel(sev) {
    if (sev === 'crit') return S.severityOverdue;
    if (sev === 'warn') return S.severitySoon;
    return S.severityLater;
  }

  function deltaVariant(n) {
    if (!Number.isFinite(n)) return '';
    if (n > 0) return 'bad';
    if (n < 0) return 'good';
    return '';
  }

  function formatDelta(n) {
    if (!Number.isFinite(n)) return '';
    if (n > 0) return '+' + n;
    if (n < 0) return String(n);
    return '0';
  }

  function nextRunAt(job) {
    if (!job || job.enabled === false || job.paused) return null;
    if (!(job.intervalMs > 0)) return null;
    if (!job.lastExecution) return null;
    const last = Date.parse(job.lastExecution);
    if (!Number.isFinite(last)) return null;
    return last + job.intervalMs;
  }

  function jobState(job) {
    if (job.isRunning) return { variant: 'ok', label: S.jobRunning };
    if (job.paused || job.enabled === false) return { variant: 'idle', label: S.jobPaused };
    if (job.errorCount > 0) return { variant: 'warn', label: S.jobErrors(job.errorCount) };
    return { variant: 'ok', label: S.jobOk };
  }

  function pickJobs(jobs, n) {
    const sorted = jobs.slice().sort(function (a, b) {
      const na = nextRunAt(a);
      const nb = nextRunAt(b);
      if (na === null && nb === null) return a.name.localeCompare(b.name);
      if (na === null) return 1;
      if (nb === null) return -1;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });
    return sorted.slice(0, n);
  }

  function typeShares(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return [];
    const filtered = stats.filter(function (row) {
      return row && row.total_count > 0;
    });
    const total = filtered.reduce(function (sum, row) {
      return sum + row.total_count;
    }, 0);
    if (total <= 0) return [];
    return filtered
      .map(function (row) {
        return {
          type: row.type,
          count: row.total_count,
          pct: Math.round((row.total_count / total) * 100),
        };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });
  }

  function linkEndpoint(endpoint) {
    if (endpoint && typeof endpoint === 'object') return endpoint.id;
    return endpoint;
  }

  function slotNeighborhood(mapData, slot) {
    if (!mapData || !Array.isArray(mapData.nodes) || !Array.isArray(mapData.links)) return null;
    const anchorNode = mapData.nodes.find(function (node) {
      return node.type === 'anchor' && node.slot === slot;
    });
    if (!anchorNode) return null;

    const nodeById = {};
    mapData.nodes.forEach(function (node) {
      nodeById[node.id] = node;
    });

    const adj = {};
    mapData.links.forEach(function (link) {
      const src = linkEndpoint(link.source);
      const tgt = linkEndpoint(link.target);
      if (!adj[src]) adj[src] = [];
      adj[src].push(tgt);
    });

    const hops = { 1: 0, 2: 0, 3: 0 };
    const visited = new Set();
    const queue = [anchorNode.id];
    visited.add(anchorNode.id);

    while (queue.length > 0) {
      const id = queue.shift();
      const neighbors = adj[id] || [];
      neighbors.forEach(function (nbId) {
        if (visited.has(nbId)) return;
        visited.add(nbId);
        const node = nodeById[nbId];
        if (node && node.type === 'memory') {
          const hd = node.hop_distance;
          if (hd === 1 || hd === 2 || hd === 3) hops[hd] += 1;
        }
        queue.push(nbId);
      });
    }

    return { anchor: anchorNode, hops: hops };
  }

  function formatClock(ms, nowMs) {
    const d = new Date(ms);
    const now = new Date(nowMs);
    function pad(n) {
      return n < 10 ? '0' + n : String(n);
    }
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max) + '…';
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setState(el, kind, text) {
    if (!el) return;
    clearChildren(el);
    const p = document.createElement('p');
    p.className = kind === 'loading' ? 'm-loading' : kind === 'empty' ? 'm-empty' : 'm-error';
    if (kind === 'error') p.setAttribute('role', 'alert');
    p.textContent = text;
    el.appendChild(p);
  }

  function adminFetch(url) {
    const fetchFn = typeof global.mementoAdminFetch === 'function' ? global.mementoAdminFetch : global.fetch;
    return fetchFn(url);
  }

  async function getJson(url) {
    const response = await adminFetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  function renderStatError(container, labelText, message) {
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const label = document.createElement('div');
    label.className = 'm-stat__label';
    label.textContent = labelText;
    stat.appendChild(label);
    const err = document.createElement('p');
    err.className = 'm-error';
    err.setAttribute('role', 'alert');
    err.textContent = S.loadError(message);
    stat.appendChild(err);
    container.appendChild(stat);
  }

  function renderReviewTile(container, data, err) {
    if (err) {
      renderStatError(container, S.tileReview, err.message);
      return;
    }
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const label = document.createElement('div');
    label.className = 'm-stat__label';
    label.textContent = S.tileReview;
    stat.appendChild(label);
    const value = document.createElement('div');
    value.className = 'm-stat__value';
    const pending = data && data.review ? data.review.pendingTotal : 0;
    value.textContent = String(pending);
    stat.appendChild(value);
    const netFlow = data && data.review ? data.review.netFlow1h : 0;
    const deltaText = formatDelta(netFlow);
    if (deltaText) {
      const delta = document.createElement('span');
      delta.className = 'm-stat__delta';
      const variant = deltaVariant(netFlow);
      if (variant) delta.classList.add('m-stat__delta--' + variant);
      delta.textContent = deltaText;
      stat.appendChild(delta);
    }
    const note = document.createElement('div');
    note.className = 'm-stat__note';
    note.textContent = S.tileReviewNote;
    stat.appendChild(note);
    container.appendChild(stat);
  }

  function renderBatchTile(container, data, err) {
    if (err) {
      renderStatError(container, S.tileBatch, err.message);
      return;
    }
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const label = document.createElement('div');
    label.className = 'm-stat__label';
    label.textContent = S.tileBatch;
    stat.appendChild(label);
    const value = document.createElement('div');
    value.className = 'm-stat__value';
    const failed = data && data.batchImpact ? data.batchImpact.failedRunCount : 0;
    value.textContent = String(failed);
    stat.appendChild(value);
    const note = document.createElement('div');
    note.className = 'm-stat__note';
    const windowDays = data ? data.windowDays : 0;
    const durationHuman = data && data.batchImpact ? data.batchImpact.durationHuman : '';
    note.textContent = S.tileBatchNote(windowDays, durationHuman);
    stat.appendChild(note);
    container.appendChild(stat);
  }

  function renderEmbeddingTile(container, data, err) {
    if (err) {
      renderStatError(container, S.tileEmbedding, err.message);
      return;
    }
    const diag = data && data.diagnostics ? data.diagnostics : {};
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const label = document.createElement('div');
    label.className = 'm-stat__label';
    label.textContent = S.tileEmbedding;
    stat.appendChild(label);
    const value = document.createElement('div');
    value.className = 'm-stat__value';
    const coverage = diag.coverage;
    if (coverage === null || coverage === undefined) {
      value.textContent = '—';
    } else {
      value.textContent = ((1 - coverage) * 100).toFixed(1) + '%';
    }
    stat.appendChild(value);
    const problems =
      (diag.missingEmbeddingCount || 0) +
      (diag.unreadableEmbeddingCount || 0) +
      (diag.dimensionMismatchCount || 0) +
      (diag.providerDriftCount || 0) +
      (diag.modelDriftCount || 0);
    const note = document.createElement('div');
    note.className = 'm-stat__note';
    note.textContent = S.tileEmbeddingNote(problems, diag.memoryCount || 0);
    stat.appendChild(note);
    container.appendChild(stat);
  }

  function renderMemoryTile(container, data, err) {
    if (err) {
      renderStatError(container, S.tileMemory, err.message);
      return;
    }
    const stats = data && Array.isArray(data.stats) ? data.stats : [];
    const shares = typeShares(stats);
    const total = shares.reduce(function (sum, row) {
      return sum + row.count;
    }, 0);
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const label = document.createElement('div');
    label.className = 'm-stat__label';
    label.textContent = S.tileMemory;
    stat.appendChild(label);
    const value = document.createElement('div');
    value.className = 'm-stat__value';
    value.textContent = String(total);
    stat.appendChild(value);
    if (shares.length === 0) {
      container.appendChild(stat);
      return;
    }
    const parts = shares.map(function (row) {
      return row.type + ' ' + row.pct + '%';
    }).join(' · ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'm-sparkline');
    svg.setAttribute('viewBox', '0 0 100 8');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', S.typeBarLabel(parts));
    let x = 0;
    shares.forEach(function (row) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('width', String(row.pct));
      rect.setAttribute('y', '0');
      rect.setAttribute('height', '8');
      rect.setAttribute('class', 'oo-type oo-type--' + row.type);
      svg.appendChild(rect);
      x += row.pct;
    });
    stat.appendChild(svg);
    const note = document.createElement('div');
    note.className = 'm-stat__note';
    note.textContent = parts;
    stat.appendChild(note);
    container.appendChild(stat);
  }

  function renderKpis(statusRes, embeddingRes, forgettingRes) {
    const container = document.getElementById('oo-kpis');
    if (!container) return;
    clearChildren(container);
    renderReviewTile(
      container,
      statusRes.status === 'fulfilled' ? statusRes.value : null,
      statusRes.status === 'rejected' ? statusRes.reason : null,
    );
    renderBatchTile(
      container,
      statusRes.status === 'fulfilled' ? statusRes.value : null,
      statusRes.status === 'rejected' ? statusRes.reason : null,
    );
    renderEmbeddingTile(
      container,
      embeddingRes.status === 'fulfilled' ? embeddingRes.value : null,
      embeddingRes.status === 'rejected' ? embeddingRes.reason : null,
    );
    renderMemoryTile(
      container,
      forgettingRes.status === 'fulfilled' ? forgettingRes.value : null,
      forgettingRes.status === 'rejected' ? forgettingRes.reason : null,
    );
  }

  function renderReview(data, err) {
    const container = document.getElementById('oo-review');
    if (!container) return;
    if (err) {
      setState(container, 'error', S.loadError(err.message));
      return;
    }
    const candidates = data && Array.isArray(data.candidates) ? data.candidates.slice(0, 5) : [];
    if (candidates.length === 0) {
      setState(container, 'empty', S.reviewEmpty);
      return;
    }
    clearChildren(container);
    const list = document.createElement('ul');
    list.className = 'oo-list';
    const nowMs = Date.now();
    candidates.forEach(function (candidate) {
      const item = document.createElement('li');
      item.className = 'oo-list__item';
      const sev = reviewSeverity(candidate.due_at, nowMs);
      const badge = document.createElement('span');
      badge.className = 'm-badge m-badge--' + sev;
      badge.textContent = severityLabel(sev);
      item.appendChild(badge);
      const text = document.createElement('span');
      text.className = 'oo-list__text';
      const reason = candidate.reason || '';
      text.textContent = truncate(reason, 80);
      text.title = reason;
      item.appendChild(text);
      const meta = document.createElement('span');
      meta.className = 'oo-list__meta';
      const created = Date.parse(candidate.created_at);
      meta.textContent = Number.isFinite(created) ? S.elapsed(nowMs - created) : '';
      item.appendChild(meta);
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function renderJobs(data, err) {
    const container = document.getElementById('oo-jobs');
    if (!container) return;
    if (err) {
      setState(container, 'error', S.loadError(err.message));
      return;
    }
    const jobs = data && Array.isArray(data.jobs) ? data.jobs : [];
    if (jobs.length === 0) {
      setState(container, 'empty', S.jobsEmpty);
      return;
    }
    clearChildren(container);
    const list = document.createElement('ul');
    list.className = 'oo-list';
    const nowMs = Date.now();
    pickJobs(jobs, 3).forEach(function (job) {
      const item = document.createElement('li');
      item.className = 'oo-list__item';
      const state = jobState(job);
      const badge = document.createElement('span');
      badge.className = 'm-badge m-badge--' + state.variant;
      badge.textContent = state.label;
      item.appendChild(badge);
      const text = document.createElement('span');
      text.className = 'oo-list__text oo-mono';
      text.textContent = job.name || '';
      item.appendChild(text);
      const meta = document.createElement('span');
      meta.className = 'oo-list__meta';
      const next = nextRunAt(job);
      meta.textContent = next !== null ? S.nextRun(formatClock(next, nowMs)) : S.nextRun('—');
      item.appendChild(meta);
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function resolveAgentId(agentsPayload) {
    const anchorMap = global.__MEMENTO_ANCHOR_MAP__;
    if (anchorMap && typeof anchorMap.getSelectedAgentId === 'function') {
      const selected = anchorMap.getSelectedAgentId();
      if (selected && selected !== 'default') return selected;
    }
    const agents = agentsPayload && Array.isArray(agentsPayload.agents) ? agentsPayload.agents : [];
    if (agents.length > 0 && agents[0].agent_id) return agents[0].agent_id;
    return 'default';
  }

  async function renderAnchor(agentsRes, gen) {
    const container = document.getElementById('oo-anchor');
    if (!container) return;
    if (agentsRes.status === 'rejected') {
      setState(container, 'error', S.loadError(agentsRes.reason.message));
      return;
    }
    const agentId = resolveAgentId(agentsRes.value);
    try {
      const mapData = await getJson('/api/anchors/map?agent_id=' + encodeURIComponent(agentId));
      if (gen !== refreshGeneration) return;
      const neighborhood = slotNeighborhood(mapData, 'A');
      if (!neighborhood) {
        setState(container, 'empty', S.anchorEmpty);
        return;
      }
      clearChildren(container);
      const meta = document.createElement('p');
      meta.className = 'oo-anchor__meta';
      meta.textContent = S.anchorAgent(agentId);
      container.appendChild(meta);
      const content = document.createElement('p');
      content.className = 'oo-anchor__content';
      content.textContent = truncate(neighborhood.anchor.content || '', 140);
      container.appendChild(content);
      const hops = document.createElement('p');
      hops.className = 'oo-anchor__hops';
      hops.textContent = S.anchorHops(neighborhood.hops[1], neighborhood.hops[2], neighborhood.hops[3]);
      container.appendChild(hops);
    } catch (err) {
      if (gen !== refreshGeneration) return;
      setState(container, 'error', S.loadError(err.message));
    }
  }

  async function refresh() {
    const gen = ++refreshGeneration;
    const kpisEl = document.getElementById('oo-kpis');
    const anchorEl = document.getElementById('oo-anchor');
    const reviewEl = document.getElementById('oo-review');
    const jobsEl = document.getElementById('oo-jobs');
    if (kpisEl) setState(kpisEl, 'loading', S.loading);
    if (anchorEl) setState(anchorEl, 'loading', S.loading);
    if (reviewEl) setState(reviewEl, 'loading', S.loading);
    if (jobsEl) setState(jobsEl, 'loading', S.loading);

    const results = await Promise.allSettled([
      getJson('/admin/status'),
      getJson('/admin/embedding-health?provider=minilm'),
      getJson('/admin/stats/forgetting'),
      getJson(REVIEW_URL),
      getJson('/admin/batch/stats'),
      getJson('/api/anchors/agents'),
    ]);

    if (gen !== refreshGeneration) return;

    renderKpis(results[0], results[1], results[2]);
    renderReview(
      results[3].status === 'fulfilled' ? results[3].value : null,
      results[3].status === 'rejected' ? results[3].reason : null,
    );
    renderJobs(
      results[4].status === 'fulfilled' ? results[4].value : null,
      results[4].status === 'rejected' ? results[4].reason : null,
    );
    await renderAnchor(results[5], gen);
  }

  function init() {
    if (wired) return;
    wired = true;
    const refreshBtn = document.getElementById('oo-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    document.querySelectorAll('[data-oo-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tab = btn.getAttribute('data-oo-goto');
        if (global.__MEMENTO_DASHBOARD_TABS__ && typeof global.__MEMENTO_DASHBOARD_TABS__.activateTab === 'function') {
          global.__MEMENTO_DASHBOARD_TABS__.activateTab(tab);
        }
      });
    });
  }

  global.__MEMENTO_OPS_OVERVIEW__ = {
    REVIEW_URL: REVIEW_URL,
    reviewSeverity: reviewSeverity,
    severityLabel: severityLabel,
    deltaVariant: deltaVariant,
    formatDelta: formatDelta,
    nextRunAt: nextRunAt,
    jobState: jobState,
    pickJobs: pickJobs,
    typeShares: typeShares,
    slotNeighborhood: slotNeighborhood,
    formatClock: formatClock,
    refresh: refresh,
    init: init,
  };

  global.initOpsOverviewPanel = function () {
    init();
    refresh();
  };
})(typeof window !== 'undefined' ? window : globalThis);
