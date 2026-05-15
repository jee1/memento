/**
 * Memory evolution demo tab — API-backed shell (#340, #342, #344).
 * View states: loading | empty | error | ready
 */
(function (global) {
  'use strict';

  const SCENARIOS_URL = '/admin/evolution-demo/scenarios';
  const SNAPSHOT_URL_PREFIX = '/admin/evolution-demo/snapshots/';
  const VALID_STATES = ['loading', 'empty', 'error', 'ready'];
  const FORGETTING_POLICY_ID = 'forgetting-policy';

  const OUTCOME_LABELS = {
    forget: '망각',
    preserve: '보존 (semantic)',
    pin: '핀 고정',
  };

  let viewState = 'loading';
  let bound = false;
  let panelInitialized = false;
  let scenarios = [];
  let loadGeneration = 0;

  const els = {
    loading: null,
    empty: null,
    error: null,
    content: null,
    scenarioSelect: null,
    pointSelect: null,
    question: null,
    answer: null,
    memorySummary: null,
    memoryGroupsSection: null,
    memoryGroups: null,
    explanationHeading: null,
    explanation: null,
  };

  function bindDom() {
    if (bound) {
      return;
    }
    els.loading = document.getElementById('med-loading');
    els.empty = document.getElementById('med-empty');
    els.error = document.getElementById('med-error');
    els.content = document.getElementById('med-content');
    els.scenarioSelect = document.getElementById('med-scenario-select');
    els.pointSelect = document.getElementById('med-point-select');
    els.question = document.getElementById('med-question-text');
    els.answer = document.getElementById('med-answer-text');
    els.memorySummary = document.getElementById('med-memory-summary');
    els.memoryGroupsSection = document.getElementById('med-memory-groups-section');
    els.memoryGroups = document.getElementById('med-memory-groups');
    els.explanationHeading = document.getElementById('med-explanation-heading');
    els.explanation = document.getElementById('med-explanation-text');
    bound = Boolean(
      els.loading &&
        els.empty &&
        els.error &&
        els.content &&
        els.scenarioSelect &&
        els.pointSelect &&
        els.question &&
        els.answer &&
        els.memorySummary &&
        els.explanation
    );
  }

  function setVisible(el, visible) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', !visible);
  }

  function setViewState(state) {
    if (VALID_STATES.indexOf(state) < 0) {
      return;
    }
    bindDom();
    if (!bound) {
      return;
    }
    viewState = state;
    setVisible(els.loading, state === 'loading');
    setVisible(els.empty, state === 'empty');
    setVisible(els.error, state === 'error');
    setVisible(els.content, state === 'ready');
  }

  function setErrorMessage(message) {
    bindDom();
    if (els.error) {
      els.error.textContent = message || '데모 데이터를 불러오지 못했습니다.';
    }
  }

  function getFetchFn() {
    return typeof global.mementoAdminFetch === 'function' ? global.mementoAdminFetch : null;
  }

  function parseJsonResponse(res) {
    return res.json().then(function (body) {
      return { ok: res.ok, status: res.status, body: body };
    }).catch(function () {
      return { ok: res.ok, status: res.status, body: {} };
    });
  }

  function readErrorFromBody(body, fallback) {
    if (body && typeof body.error === 'string' && body.error.trim() !== '') {
      return body.error.trim();
    }
    if (body && typeof body.message === 'string' && body.message.trim() !== '') {
      return body.message.trim();
    }
    return fallback;
  }

  function isForgettingPolicy(scenarioId) {
    return scenarioId === FORGETTING_POLICY_ID;
  }

  function formatImportance(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '—';
    }
    return Math.round(value * 100) + '%';
  }

  function renderMemoryGroups(snapshot, scenarioId) {
    bindDom();
    const showGroups =
      isForgettingPolicy(scenarioId) &&
      snapshot &&
      Array.isArray(snapshot.memory_groups) &&
      snapshot.memory_groups.length > 0;

    if (els.memoryGroupsSection) {
      setVisible(els.memoryGroupsSection, showGroups);
    }
    if (!els.memoryGroups) {
      return;
    }
    els.memoryGroups.innerHTML = '';
    if (!showGroups) {
      return;
    }

    snapshot.memory_groups.forEach(function (group) {
      const outcome = group && group.outcome ? group.outcome : 'preserve';
      const card = document.createElement('article');
      card.className = 'med-memory-group-card med-memory-group-card--' + outcome;
      card.setAttribute('data-outcome', outcome);
      card.setAttribute('data-importance', String(group.importance ?? ''));
      card.setAttribute('data-pinned', group.pinned ? 'true' : 'false');

      const label = document.createElement('h4');
      label.className = 'med-memory-group-card__label';
      label.textContent = group.label || '기억';

      const meta = document.createElement('p');
      meta.className = 'med-memory-group-card__meta';
      meta.textContent =
        '중요도 ' +
        formatImportance(group.importance) +
        (group.pinned ? ' · 핀 고정' : '');

      const status = document.createElement('p');
      status.className = 'med-memory-group-card__status';
      status.textContent = group.status || '';

      const outcomeEl = document.createElement('p');
      outcomeEl.className =
        'med-memory-group-card__outcome med-memory-group-card__outcome--' + outcome;
      outcomeEl.textContent = OUTCOME_LABELS[outcome] || outcome;

      card.appendChild(label);
      card.appendChild(meta);
      card.appendChild(status);
      card.appendChild(outcomeEl);
      els.memoryGroups.appendChild(card);
    });
  }

  function formatMemorySummary(summary) {
    if (!summary || typeof summary !== 'object') {
      return '';
    }
    const counts = [
      '에피소딕 ' + (summary.episodic_count ?? 0),
      '시맨틱 ' + (summary.semantic_count ?? 0),
      '망각 ' + (summary.forgotten_count ?? 0),
      '보존 ' + (summary.preserved_count ?? 0),
    ].join(' · ');
    const text = typeof summary.summary_text === 'string' ? summary.summary_text.trim() : '';
    return text ? counts + '\n\n' + text : counts;
  }

  function renderSnapshot(snapshot, scenarioId) {
    bindDom();
    if (!bound || !snapshot) {
      return;
    }
    const activeScenarioId = scenarioId || (els.scenarioSelect ? els.scenarioSelect.value : '');
    if (els.question) {
      els.question.textContent = snapshot.question || '';
      els.question.classList.remove('med-placeholder');
    }
    if (els.answer) {
      els.answer.textContent = snapshot.answer || '';
      els.answer.classList.remove('med-placeholder');
    }
    if (els.memorySummary) {
      els.memorySummary.textContent = formatMemorySummary(snapshot.memory_summary);
      els.memorySummary.classList.remove('med-placeholder');
    }
    renderMemoryGroups(snapshot, activeScenarioId);
    if (els.explanationHeading) {
      els.explanationHeading.textContent = isForgettingPolicy(activeScenarioId)
        ? '왜 보존·망각이 갈리나요?'
        : '설명';
    }
    if (els.explanation) {
      els.explanation.textContent = snapshot.explanation || '';
      els.explanation.classList.remove('med-placeholder');
    }
    setViewState('ready');
  }

  function populatePointSelect(scenario) {
    bindDom();
    if (!els.pointSelect) {
      return;
    }
    const select = els.pointSelect;
    select.innerHTML = '';
    const points = scenario && Array.isArray(scenario.points) ? scenario.points : [];
    if (points.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '시점 없음';
      select.appendChild(opt);
      select.disabled = true;
      return;
    }
    points.forEach(function (point) {
      const opt = document.createElement('option');
      opt.value = point.point_id;
      opt.textContent = point.label || point.point_id;
      select.appendChild(opt);
    });
    select.disabled = false;
  }

  function populateScenarioSelect(catalog) {
    bindDom();
    if (!els.scenarioSelect) {
      return null;
    }
    const select = els.scenarioSelect;
    select.innerHTML = '';
    scenarios = catalog && Array.isArray(catalog.scenarios) ? catalog.scenarios : [];
    if (scenarios.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '사용 가능한 시나리오 없음';
      select.appendChild(opt);
      select.disabled = true;
      if (els.pointSelect) {
        els.pointSelect.innerHTML = '<option value="">시점 선택</option>';
        els.pointSelect.disabled = true;
      }
      return null;
    }
    scenarios.forEach(function (scenario) {
      const opt = document.createElement('option');
      opt.value = scenario.scenario_id;
      opt.textContent = scenario.title || scenario.scenario_id;
      select.appendChild(opt);
    });
    select.disabled = false;
    return scenarios[0];
  }

  function findScenario(scenarioId) {
    return scenarios.find(function (s) {
      return s.scenario_id === scenarioId;
    });
  }

  function loadSnapshot(scenarioId, pointId) {
    const fetchFn = getFetchFn();
    if (!fetchFn) {
      setErrorMessage('mementoAdminFetch를 사용할 수 없습니다.');
      setViewState('error');
      return Promise.resolve();
    }
    if (!scenarioId || !pointId) {
      setViewState('empty');
      return Promise.resolve();
    }

    const generation = ++loadGeneration;
    setViewState('loading');

    const url = SNAPSHOT_URL_PREFIX + encodeURIComponent(scenarioId) + '/' + encodeURIComponent(pointId);
    return fetchFn(url, { headers: { Accept: 'application/json' } })
      .then(parseJsonResponse)
      .then(function (result) {
        if (generation !== loadGeneration) {
          return;
        }
        if (!result.ok) {
          setErrorMessage(readErrorFromBody(result.body, '스냅샷 조회 실패 (HTTP ' + result.status + ')'));
          setViewState('error');
          return;
        }
        renderSnapshot(result.body, scenarioId);
      })
      .catch(function (err) {
        if (generation !== loadGeneration) {
          return;
        }
        setErrorMessage(err && err.message ? err.message : '스냅샷 조회 중 오류가 발생했습니다.');
        setViewState('error');
      });
  }

  function onPointChange() {
    bindDom();
    if (!els.scenarioSelect || !els.pointSelect) {
      return;
    }
    const scenarioId = els.scenarioSelect.value;
    const pointId = els.pointSelect.value;
    loadSnapshot(scenarioId, pointId);
  }

  function onScenarioChange() {
    bindDom();
    if (!els.scenarioSelect) {
      return;
    }
    const scenario = findScenario(els.scenarioSelect.value);
    populatePointSelect(scenario);
    if (scenario && scenario.points && scenario.points.length > 0) {
      if (els.pointSelect) {
        els.pointSelect.value = scenario.points[0].point_id;
      }
      loadSnapshot(scenario.scenario_id, scenario.points[0].point_id);
    } else {
      setViewState('empty');
    }
  }

  function bindControls() {
    bindDom();
    if (!bound || panelInitialized) {
      return;
    }
    if (els.scenarioSelect) {
      els.scenarioSelect.addEventListener('change', onScenarioChange);
    }
    if (els.pointSelect) {
      els.pointSelect.addEventListener('change', onPointChange);
    }
    panelInitialized = true;
  }

  function loadScenarios() {
    const fetchFn = getFetchFn();
    if (!fetchFn) {
      setErrorMessage('mementoAdminFetch를 사용할 수 없습니다.');
      setViewState('error');
      return Promise.resolve();
    }

    const generation = ++loadGeneration;
    setViewState('loading');

    return fetchFn(SCENARIOS_URL, { headers: { Accept: 'application/json' } })
      .then(parseJsonResponse)
      .then(function (result) {
        if (generation !== loadGeneration) {
          return;
        }
        if (!result.ok) {
          setErrorMessage(readErrorFromBody(result.body, '시나리오 목록 조회 실패 (HTTP ' + result.status + ')'));
          setViewState('error');
          return;
        }
        const first = populateScenarioSelect(result.body);
        if (!first) {
          setViewState('empty');
          return;
        }
        populatePointSelect(first);
        if (els.scenarioSelect) {
          els.scenarioSelect.value = first.scenario_id;
        }
        if (els.pointSelect && first.points && first.points.length > 0) {
          els.pointSelect.value = first.points[0].point_id;
          return loadSnapshot(first.scenario_id, first.points[0].point_id);
        }
        setViewState('empty');
      })
      .catch(function (err) {
        if (generation !== loadGeneration) {
          return;
        }
        setErrorMessage(err && err.message ? err.message : '시나리오 목록 조회 중 오류가 발생했습니다.');
        setViewState('error');
      });
  }

  function initPanel() {
    bindDom();
    bindControls();
    return loadScenarios();
  }

  function refresh() {
    bindDom();
    bindControls();
    return loadScenarios();
  }

  function init() {
    bindDom();
    setViewState(viewState);
  }

  global.__MEMENTO_EVOLUTION_DEMO_SHELL__ = {
    init: init,
    initPanel: initPanel,
    refresh: refresh,
    setViewState: setViewState,
    getViewState: function () {
      return viewState;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
