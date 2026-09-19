/**
 * Embedding map fetch — status and params (Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  st.readParams = function readParams() {
    const prov = document.getElementById('em-provider');
    const lim = document.getElementById('em-limit');
    const kEl = document.getElementById('em-k');
    return {
      provider: prov ? prov.value : 'minilm',
      limit: lim ? parseInt(lim.value, 10) || 300 : 300,
      k: kEl ? parseInt(kEl.value, 10) || 6 : 6,
    };
  };

  function setLoading(on) {
    const el = document.getElementById('em-loading');
    if (el) {
      el.classList.toggle('hidden', !on);
    }
  }

  function setError(msg, showRetry) {
    const el = document.getElementById('em-error');
    if (!el) {
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    if (!msg) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const p = document.createElement('p');
    p.textContent = msg;
    el.appendChild(p);
    if (showRetry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'em-retry-btn';
      retry.textContent = '재시도';
      retry.addEventListener('click', function () {
        st.loadEmbeddingMap(st.readParams());
      });
      el.appendChild(retry);
    }
  }

  function updateCacheInfo(meta) {
    const el = document.getElementById('em-cache-info');
    if (!el || !meta) {
      return;
    }
    if (meta.cached && meta.computed_at) {
      const ms = Date.now() - new Date(meta.computed_at).getTime();
      const min = Math.max(0, Math.round(ms / 60000));
      el.textContent = `${min}분 전 캐시`;
    } else {
      el.textContent = '';
    }
  }

  function metricCard(label, value, problem, provider) {
    const card = document.createElement(problem ? 'button' : 'div');
    card.className = 'm-metric' + (problem ? ' em-health-problem-card' : '');
    if (problem) {
      card.type = 'button';
      card.addEventListener('click', function () {
        st.loadEmbeddingProblems(problem, provider);
      });
    }
    const labelEl = document.createElement('div');
    labelEl.className = 'm-metric__label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'm-metric__value';
    valueEl.textContent = String(value);
    card.appendChild(labelEl);
    card.appendChild(valueEl);
    return card;
  }

  function renderEmbeddingHealthError(message) {
    const el = document.getElementById('em-health-error');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  function renderEmbeddingHealth(health) {
    const summary = document.getElementById('em-health-summary');
    const problems = document.getElementById('em-health-problems');
    if (!summary || !problems || !health) return;
    renderEmbeddingHealthError('');
    const coverage = health.coverage == null ? '—' : (Number(health.coverage) * 100).toFixed(1) + '%';
    summary.replaceChildren(
      metricCard('활성 기억', health.memoryCount),
      metricCard('검색 가능 임베딩', health.validEmbeddingCount),
      metricCard('커버리지', coverage),
      metricCard('진단 시각', health.diagnosedAt || '—')
    );
    problems.replaceChildren(
      metricCard('누락', health.missingEmbeddingCount, 'missing_embedding', health.provider),
      metricCard('읽기 불가/손상', health.unreadableEmbeddingCount, 'unreadable_embedding', health.provider),
      metricCard('차원 불일치', health.dimensionMismatchCount, 'dimension_mismatch', health.provider),
      metricCard('제공자 드리프트', health.providerDriftCount, 'provider_drift', health.provider),
      metricCard('모델 드리프트', health.modelDriftCount, 'model_drift', health.provider)
    );
  }

  function renderEmbeddingProblemList(page) {
    const el = document.getElementById('em-problem-list');
    if (!el || !page) return;
    el.replaceChildren();
    const heading = document.createElement('h3');
    heading.className = 'rc-health-subtitle';
    heading.textContent = page.problem + ' (' + page.total + ')';
    el.appendChild(heading);
    if (!page.memories || page.memories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rc-health-hint';
      empty.textContent = '영향을 받는 활성 기억이 없습니다.';
      el.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'em-problem-memory-list';
      page.memories.forEach(function (memory) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'm-button m-button--ghost';
        button.textContent = memory.id;
        button.addEventListener('click', function () {
          st.openMemoryById(memory.id);
        });
        const meta = document.createElement('span');
        meta.textContent = [memory.type, memory.ownerId, memory.projectId].filter(Boolean).join(' · ');
        item.appendChild(button);
        item.appendChild(meta);
        list.appendChild(item);
      });
      el.appendChild(list);
    }
    if (page.total > page.limit) {
      const nav = document.createElement('div');
      nav.className = 'em-problem-pagination';
      const provider = st.lastHealth && st.lastHealth.provider;
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'm-button m-button--secondary';
      previous.textContent = '이전';
      previous.disabled = page.offset === 0;
      previous.addEventListener('click', function () {
        st.loadEmbeddingProblems(page.problem, provider, Math.max(0, page.offset - page.limit));
      });
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'm-button m-button--secondary';
      next.textContent = '다음';
      next.disabled = page.offset + page.limit >= page.total;
      next.addEventListener('click', function () {
        st.loadEmbeddingProblems(page.problem, provider, page.offset + page.limit);
      });
      nav.appendChild(previous);
      nav.appendChild(document.createTextNode(
        Math.min(page.offset + 1, page.total) + '–' + Math.min(page.offset + page.limit, page.total) + ' / ' + page.total
      ));
      nav.appendChild(next);
      el.appendChild(nav);
    }
    el.classList.remove('hidden');
  }

  function renderEmbeddingMapMeta(data) {
    const el = document.getElementById('em-sample-info');
    const clustersEl = document.getElementById('em-cluster-summary');
    const meta = data && data.meta;
    if (!el || !meta || meta.selected_count == null) return;
    const excluded =
      Number(meta.excluded_unreadable_count || 0) +
      Number(meta.excluded_dimension_mismatch_count || 0) +
      Number(meta.excluded_model_drift_count || 0);
    const population = st.lastHealth ? st.lastHealth.memoryCount : meta.population_count;
    const cache = meta.cached ? 'cache hit' : 'fresh';
    el.textContent =
      '활성 기억 ' + population + '개 중 중요도·최신순 ' + meta.selected_count +
      '개 · 표시 ' + meta.displayed_count + '개 · 제외 ' + excluded + '개 · ' +
      meta.provider + ' / ' + (meta.model || 'provider default') + ' / ' + meta.dimensions +
      '차원 · ' + meta.computed_at + ' · ' + cache;

    if (!clustersEl) return;
    clustersEl.replaceChildren();
    const groups = new Map();
    (data.points || []).forEach(function (point) {
      const group = groups.get(point.cluster) || { count: 0, types: {}, tags: {} };
      group.count++;
      group.types[point.type] = (group.types[point.type] || 0) + 1;
      (point.tags || []).forEach(function (tag) {
        group.tags[tag] = (group.tags[tag] || 0) + 1;
      });
      groups.set(point.cluster, group);
    });
    groups.forEach(function (group, cluster) {
      const item = document.createElement('span');
      const types = Object.entries(group.types).map(function (entry) {
        return entry[0] + ' ' + entry[1];
      }).join(', ');
      const tags = Object.entries(group.tags)
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 3)
        .map(function (entry) { return entry[0]; })
        .join(', ');
      item.textContent = '클러스터 ' + cluster + ': ' + group.count + ' · ' + types + (tags ? ' · ' + tags : '');
      clustersEl.appendChild(item);
    });
  }

  st.setEmbeddingMapLoading = setLoading;
  st.setEmbeddingMapError = setError;
  st.updateEmbeddingMapCacheInfo = updateCacheInfo;
  st.renderEmbeddingHealthError = renderEmbeddingHealthError;
  st.renderEmbeddingHealth = renderEmbeddingHealth;
  st.renderEmbeddingProblemList = renderEmbeddingProblemList;
  st.renderEmbeddingMapMeta = renderEmbeddingMapMeta;
})(typeof window !== 'undefined' ? window : globalThis);
