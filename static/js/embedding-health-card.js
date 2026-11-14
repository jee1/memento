/**
 * Embedding health card on the ops status tab (#1701).
 * Exception to "the status tab reads zones only" (#1697 N10): the provider
 * picker and the problem list need GET /admin/embedding-health directly.
 * No colors here; severity colors come only from the server zones rows.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const REINDEX = '재색인으로 고칩니다.';

  const PROBLEMS = [
    {
      key: 'missing_embedding',
      field: 'missingEmbeddingCount',
      label: '누락',
      term: '선택한 제공자의 임베딩이 아직 없는 기억.',
      action: REINDEX,
    },
    {
      key: 'unreadable_embedding',
      field: 'unreadableEmbeddingCount',
      label: '읽기 불가/손상',
      term: '임베딩이 저장돼 있지만 벡터로 읽히지 않는 기억.',
      action: REINDEX,
    },
    {
      key: 'dimension_mismatch',
      field: 'dimensionMismatchCount',
      label: '차원 불일치',
      term: '저장된 차원이나 벡터 길이가 제공자가 기대하는 차원과 다른 기억.',
      action: REINDEX,
    },
    {
      key: 'provider_drift',
      field: 'providerDriftCount',
      label: '제공자 드리프트',
      term: '선택한 제공자 말고 다른 제공자의 임베딩도 함께 가진 기억. 커버리지에는 영향이 없다.',
      action: '재색인에 --prune-foreign-providers 를 붙이면 재색인에 성공한 기억의 다른 제공자 임베딩을 지웁니다.',
    },
    {
      key: 'model_drift',
      field: 'modelDriftCount',
      label: '모델 드리프트',
      term: '제공자는 맞지만 저장된 모델이 현재 모델과 다른 기억. 벡터 검색에서 제외된다.',
      action: REINDEX,
    },
  ];

  const state = { wired: false, generation: 0, problemGeneration: 0, lastHealth: null };

  function $(id) {
    return doc.getElementById(id);
  }

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getJson(url) {
    return global.mementoAdminFetch(url).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  function errorMessage(r) {
    return (r.body && (r.body.message || r.body.error)) || '요청 실패 (' + r.status + ')';
  }

  function showError(message) {
    const box = $('em-health-error');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  function clearBody() {
    ['em-health-headline', 'em-health-guide', 'em-health-summary', 'em-health-problems', 'em-problem-list']
      .forEach(function (id) {
        const node = $(id);
        if (node) node.replaceChildren();
      });
    const list = $('em-problem-list');
    if (list) list.classList.add('hidden');
  }

  function metricCard(label, value, problemKey, provider, asNote) {
    const card = el(problemKey ? 'button' : 'div', 'm-stat' + (problemKey ? ' em-health-problem-card' : ''));
    if (problemKey) {
      card.type = 'button';
      card.addEventListener('click', function () {
        loadProblems(problemKey, provider, 0);
      });
    }
    card.appendChild(el('div', 'm-stat__label', label));
    card.appendChild(el('div', asNote ? 'm-stat__note' : 'm-stat__value', String(value)));
    return card;
  }

  function renderGuide(health, active) {
    const guide = $('em-health-guide');
    if (!guide) return;
    guide.replaceChildren();
    if (active.length === 0) {
      guide.appendChild(el('p', 'm-panel__note', '조치 불필요. 활성 기억 모두 ' + health.provider + ' 임베딩이 정상입니다.'));
      return;
    }
    const list = el('ul', 'em-health-actions');
    active.forEach(function (p) {
      list.appendChild(el('li', '', p.label + ' ' + health[p.field] + '건: ' + p.action));
    });
    guide.appendChild(list);
    const note = el('p', 'm-panel__note', '대상을 먼저 확인합니다: ');
    note.appendChild(el('code', 'm-code-inline', 'npm run reindex-embeddings -- --provider ' + health.provider + ' --dry-run'));
    guide.appendChild(note);
  }

  function renderHealth(health) {
    const active = PROBLEMS.filter(function (p) {
      return Number(health[p.field]) > 0;
    });
    const total = active.reduce(function (sum, p) {
      return sum + Number(health[p.field]);
    }, 0);
    const coverage = health.coverage == null ? '—' : (Number(health.coverage) * 100).toFixed(1) + '%';

    const headline = $('em-health-headline');
    if (headline) {
      headline.textContent =
        '문제 ' + total + '건 / 커버리지 ' + coverage + ' (' + health.provider + ')';
    }
    renderGuide(health, active);

    const summary = $('em-health-summary');
    if (summary) {
      summary.replaceChildren(
        metricCard('활성 기억', health.memoryCount),
        metricCard('검색 가능 임베딩', health.validEmbeddingCount),
        metricCard('커버리지', coverage),
        metricCard('진단 시각', health.diagnosedAt || '—', null, null, true)
      );
    }
    const problems = $('em-health-problems');
    if (problems) {
      problems.replaceChildren.apply(
        problems,
        PROBLEMS.map(function (p) {
          return metricCard(p.label, health[p.field], p.key, health.provider);
        })
      );
    }
  }

  function renderTerms() {
    const terms = $('em-health-terms');
    if (!terms || terms.firstChild) return;
    terms.appendChild(el('dt', '', '커버리지'));
    terms.appendChild(el('dd', '', '활성 기억 중 임베딩이 정상(있고, 읽히고, 차원과 모델이 맞음)인 비율.'));
    PROBLEMS.forEach(function (p) {
      terms.appendChild(el('dt', '', p.label));
      terms.appendChild(el('dd', '', p.term));
    });
  }

  function openMemory(id) {
    const tabs = global.__MEMENTO_DASHBOARD_TABS__;
    if (tabs && typeof tabs.activateTab === 'function') tabs.activateTab('memory-finder');
    const input = $('mf-id-input');
    if (input) input.value = id;
    const finder = global.__MEMENTO_MEMORY_FINDER__;
    if (finder && typeof finder.open === 'function') finder.open(id);
  }

  function renderProblemList(page, provider) {
    const box = $('em-problem-list');
    if (!box || !page) return;
    box.replaceChildren();
    box.appendChild(el('h4', 'm-panel__subtitle', page.problem + ' (' + page.total + ')'));
    if (!page.memories || page.memories.length === 0) {
      box.appendChild(el('p', 'm-panel__note', '영향을 받는 활성 기억이 없습니다.'));
    } else {
      const list = el('ul', 'em-problem-memory-list');
      page.memories.forEach(function (memory) {
        const item = el('li');
        const open = el('button', 'm-button m-button--ghost', memory.id);
        open.type = 'button';
        open.title = '기억 찾기에서 열기';
        open.addEventListener('click', function () {
          openMemory(memory.id);
        });
        item.appendChild(open);
        item.appendChild(
          el('span', '', [memory.type, memory.ownerId, memory.projectId].filter(Boolean).join(' / '))
        );
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    if (page.total > page.limit) {
      const nav = el('div', 'em-problem-pagination');
      const previous = el('button', 'm-button m-button--secondary', '이전');
      previous.type = 'button';
      previous.disabled = page.offset === 0;
      previous.addEventListener('click', function () {
        loadProblems(page.problem, provider, Math.max(0, page.offset - page.limit));
      });
      const next = el('button', 'm-button m-button--secondary', '다음');
      next.type = 'button';
      next.disabled = page.offset + page.limit >= page.total;
      next.addEventListener('click', function () {
        loadProblems(page.problem, provider, page.offset + page.limit);
      });
      nav.appendChild(previous);
      nav.appendChild(
        doc.createTextNode(
          Math.min(page.offset + 1, page.total) + '–' + Math.min(page.offset + page.limit, page.total) + ' / ' + page.total
        )
      );
      nav.appendChild(next);
      box.appendChild(nav);
    }
    box.classList.remove('hidden');
  }

  function loadProblems(problem, provider, offset) {
    const generation = ++state.problemGeneration;
    getJson(
      '/admin/embedding-health?provider=' + encodeURIComponent(provider) +
        '&problem=' + encodeURIComponent(problem) +
        '&limit=50&offset=' + encodeURIComponent(String(offset || 0))
    )
      .then(function (r) {
        if (generation !== state.problemGeneration) return;
        if (!r.ok) {
          showError(errorMessage(r));
          return;
        }
        renderProblemList(r.body, provider);
      })
      .catch(function () {
        if (generation !== state.problemGeneration) return;
        showError('문제 기억 목록을 불러오지 못했습니다.');
      });
  }

  function load() {
    if (!global.mementoAdminFetch) {
      showError('mementoAdminFetch를 사용할 수 없습니다. memento-admin-fetch.js를 확인하세요.');
      return;
    }
    const generation = ++state.generation;
    state.problemGeneration++;
    state.lastHealth = null;
    clearBody();
    showError('');
    const select = $('em-provider');
    const provider = select ? select.value : 'minilm';
    getJson('/admin/embedding-health?provider=' + encodeURIComponent(provider))
      .then(function (r) {
        if (generation !== state.generation) return;
        if (!r.ok) {
          showError(errorMessage(r));
          return;
        }
        state.lastHealth = r.body.diagnostics;
        renderHealth(r.body.diagnostics);
      })
      .catch(function () {
        if (generation !== state.generation) return;
        showError('임베딩 진단을 불러오지 못했습니다.');
      });
  }

  function init() {
    if (!state.wired) {
      state.wired = true;
      renderTerms();
      const select = $('em-provider');
      if (select) select.addEventListener('change', load);
      const refresh = $('ops-status-refresh-btn');
      if (refresh) refresh.addEventListener('click', load);
    }
    load();
  }

  global.__MEMENTO_EMBEDDING_HEALTH__ = { state: state, PROBLEMS: PROBLEMS, load: load };
  global.initEmbeddingHealthCard = init;
})(typeof window !== 'undefined' ? window : globalThis);
