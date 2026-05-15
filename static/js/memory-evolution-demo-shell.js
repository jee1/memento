/**
 * Memory evolution demo tab — API-backed shell (#340, #342, #395).
 * View states: loading | empty | error | ready
 */
(function (global) {
  'use strict';

  const SCENARIOS_URL = '/admin/evolution-demo/scenarios';
  const SNAPSHOT_URL_PREFIX = '/admin/evolution-demo/snapshots/';
  const VALID_STATES = ['loading', 'empty', 'error', 'ready'];
  const EMPTY_MESSAGE_SIGNED_OUT =
    '관리자 API 키로 로그인하면 시뮬레이션 데이터를 불러올 수 있습니다.';
  const EMPTY_MESSAGE_CHECKING =
    '대시보드 세션을 확인하는 중입니다. 로그인 후 데모 API 데이터를 불러올 수 있습니다.';
  const ANSWER_OVER_TIME_ID = 'answer-over-time';
  const FORGETTING_POLICY_ID = 'forgetting-policy';
  const CONSOLIDATION_ID = 'episodic-to-semantic';

  const OUTCOME_LABELS = {
    forget: '망각',
    preserve: '보존 (semantic)',
    pin: '핀 고정',
  };

  const COMPARISON_STAGES = [
    { pointId: 'early', label: '상세', hint: '회의·결정 맥락이 그대로 드러나는 episodic 중심 답변' },
    { pointId: 'mid', label: '압축', hint: '망각·통합으로 잡음이 걸러지고 핵심만 남은 답변' },
    { pointId: 'late', label: 'semantic 중심', hint: '사실이 semantic 기억으로 응축된 한 줄 답변' },
  ];

  const MEMORY_STAT_DEFS = [
    { key: 'episodic_count', label: '에피소딕', modifier: 'med-stat-chip--episodic' },
    { key: 'semantic_count', label: '시맨틱', modifier: 'med-stat-chip--semantic' },
    { key: 'forgotten_count', label: '망각', modifier: 'med-stat-chip--forgotten' },
    { key: 'preserved_count', label: '보존', modifier: 'med-stat-chip--preserved' },
  ];

  let viewState = 'loading';
  let bound = false;
  let panelInitialized = false;
  let scenarios = [];
  let loadGeneration = 0;
  let currentScenarioId = '';

  const els = {
    loading: null,
    empty: null,
    error: null,
    content: null,
    scenarioSelect: null,
    pointControls: null,
    pointSegment: null,
    pointSelect: null,
    pointSelectLabel: null,
    comparisonHint: null,
    question: null,
    answer: null,
    memoryStats: null,
    memorySummary: null,
    explanation: null,
    explanationHeading: null,
    consolidationPanel: null,
    standardPanels: null,
    explanationSection: null,
    episodicSourcesList: null,
    semanticResultSection: null,
    semanticResultCard: null,
    searchBefore: null,
    searchAfter: null,
    memoryGroupsSection: null,
    memoryGroups: null,
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
    els.pointControls = document.getElementById('med-point-controls');
    els.pointSegment = document.getElementById('med-point-segment');
    els.pointSelect = document.getElementById('med-point-select');
    els.pointSelectLabel = document.querySelector('.med-point-select-label');
    els.comparisonHint = document.getElementById('med-comparison-hint');
    els.question = document.getElementById('med-question-text');
    els.answer = document.getElementById('med-answer-text');
    els.memoryStats = document.getElementById('med-memory-stats');
    els.memorySummary = document.getElementById('med-memory-summary');
    els.explanation = document.getElementById('med-explanation-text');
    els.explanationHeading = document.getElementById('med-explanation-heading');
    els.consolidationPanel = document.getElementById('med-consolidation-panel');
    els.standardPanels = document.getElementById('med-standard-panels');
    els.explanationSection = document.querySelector('.med-section--explanation');
    els.episodicSourcesList = document.getElementById('med-episodic-sources-list');
    els.semanticResultSection = document.getElementById('med-semantic-result-section');
    els.semanticResultCard = document.getElementById('med-semantic-result-card');
    els.searchBefore = document.getElementById('med-search-before');
    els.searchAfter = document.getElementById('med-search-after');
    els.memoryGroupsSection = document.getElementById('med-memory-groups-section');
    els.memoryGroups = document.getElementById('med-memory-groups');
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


  function getAuthState() {
    const auth = global.__MEMENTO_DASHBOARD_AUTH__;
    if (auth && typeof auth.getState === 'function') {
      return auth.getState();
    }
    return 'signed-in';
  }

  function canLoadFromApi() {
    return getAuthState() === 'signed-in';
  }

  function isEvolutionTabActive() {
    const panel = document.getElementById('tab-evolution-demo');
    return Boolean(panel && panel.classList.contains('active'));
  }

  function showAuthRequiredState() {
    bindDom();
    if (!bound) {
      return;
    }
    const authState = getAuthState();
    if (els.empty) {
      els.empty.textContent =
        authState === 'checking' ? EMPTY_MESSAGE_CHECKING : EMPTY_MESSAGE_SIGNED_OUT;
    }
    if (els.scenarioSelect) {
      els.scenarioSelect.disabled = true;
    }
    if (els.pointSelect) {
      els.pointSelect.disabled = true;
    }
    setViewState('empty');
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
    if (state !== 'ready') {
      setVisible(els.comparisonHint, false);
    } else if (els.comparisonHint && isAnswerOverTime(currentScenarioId)) {
      setVisible(els.comparisonHint, els.comparisonHint.innerHTML.trim() !== '');
    }
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

  
  function isAnswerOverTime(scenarioId) {
    return scenarioId === ANSWER_OVER_TIME_ID;
  }

  function formatMemorySummaryText(summary) {
    if (!summary || typeof summary !== 'object' || isConsolidation(currentScenarioId)) {
      return '';
    }
    return typeof summary.summary_text === 'string' ? summary.summary_text.trim() : '';
  }


  function isConsolidation(scenarioId) {
    return scenarioId === CONSOLIDATION_ID;
  }

  function formatDate(iso) {
    if (typeof iso !== 'string' || iso.trim() === '') {
      return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function updateScenarioLayout(scenarioId) {
    bindDom();
    const consolidation = isConsolidation(scenarioId);
    setVisible(els.consolidationPanel, consolidation);
    setVisible(els.standardPanels, !consolidation);
    if (!consolidation) {
      clearConsolidationPanel();
    }
  }

  function clearConsolidationPanel() {
    bindDom();
    if (els.episodicSourcesList) {
      els.episodicSourcesList.innerHTML = '';
    }
    if (els.semanticResultCard) {
      els.semanticResultCard.innerHTML = '';
    }
    if (els.semanticResultSection) {
      setVisible(els.semanticResultSection, false);
    }
    if (els.searchBefore) {
      els.searchBefore.textContent = '';
    }
    if (els.searchAfter) {
      els.searchAfter.textContent = '';
    }
  }

  function renderEpisodicSources(sources) {
    bindDom();
    if (!els.episodicSourcesList) {
      return;
    }
    els.episodicSourcesList.innerHTML = '';
    if (!Array.isArray(sources) || sources.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'med-episodic-source med-episodic-source--empty';
      empty.textContent = '에피소딕 출처가 없습니다.';
      els.episodicSourcesList.appendChild(empty);
      return;
    }
    sources.forEach(function (source, index) {
      const item = document.createElement('li');
      item.className = 'med-episodic-source';

      const indexSpan = document.createElement('span');
      indexSpan.className = 'med-episodic-source__index';
      indexSpan.setAttribute('aria-hidden', 'true');
      indexSpan.textContent = String(index + 1);

      const body = document.createElement('div');
      body.className = 'med-episodic-source__body';

      const metaParts = [];
      if (source && source.id) {
        metaParts.push(source.id);
      }
      const created = source && formatDate(source.created_at);
      if (created) {
        metaParts.push(created);
      }
      const importance = source && formatImportance(source.importance);
      if (importance) {
        metaParts.push('중요도 ' + importance);
      }
      if (metaParts.length > 0) {
        const meta = document.createElement('span');
        meta.className = 'med-episodic-source__meta';
        meta.textContent = metaParts.join(' · ');
        body.appendChild(meta);
      }

      const summaryEl = document.createElement('p');
      summaryEl.className = 'med-episodic-source__summary';
      summaryEl.textContent = source && typeof source.summary === 'string' ? source.summary : '';
      body.appendChild(summaryEl);

      item.appendChild(indexSpan);
      item.appendChild(body);
      els.episodicSourcesList.appendChild(item);
    });
  }

  function renderSemanticResult(result) {
    bindDom();
    if (!els.semanticResultSection || !els.semanticResultCard) {
      return;
    }
    els.semanticResultCard.innerHTML = '';
    if (!result || typeof result !== 'object') {
      setVisible(els.semanticResultSection, false);
      return;
    }
    const metaParts = [];
    if (result.id) {
      metaParts.push(result.id);
    }
    if (typeof result.source_count === 'number') {
      metaParts.push('출처 ' + result.source_count + '건 통합');
    }
    if (metaParts.length > 0) {
      const meta = document.createElement('p');
      meta.className = 'med-semantic-result-card__meta';
      meta.textContent = metaParts.join(' · ');
      els.semanticResultCard.appendChild(meta);
    }
    const summary = typeof result.summary === 'string' ? result.summary : '';
    if (summary) {
      const summaryEl = document.createElement('p');
      summaryEl.className = 'med-semantic-result-card__summary';
      summaryEl.textContent = summary;
      els.semanticResultCard.appendChild(summaryEl);
    }
    const explanation = typeof result.explanation === 'string' ? result.explanation : '';
    if (explanation) {
      const expl = document.createElement('p');
      expl.className = 'med-semantic-result-card__explanation';
      expl.textContent = explanation;
      els.semanticResultCard.appendChild(expl);
    }
    setVisible(els.semanticResultSection, true);
  }

  function renderSearchComparison(comparison) {
    bindDom();
    if (!els.searchBefore || !els.searchAfter) {
      return;
    }
    const before =
      comparison && typeof comparison.before_summary === 'string'
        ? comparison.before_summary
        : '통합 전 검색 요약이 없습니다.';
    const after =
      comparison && typeof comparison.after_summary === 'string'
        ? comparison.after_summary
        : '통합 후 검색 요약이 없습니다.';
    els.searchBefore.textContent = before;
    els.searchAfter.textContent = after;
  }

  function renderConsolidationPanel(snapshot) {
    bindDom();
    if (!isConsolidation(currentScenarioId)) {
      clearConsolidationPanel();
      return;
    }
    renderEpisodicSources(snapshot && snapshot.episodic_sources);
    renderSemanticResult(snapshot && snapshot.semantic_result);
    renderSearchComparison(snapshot && snapshot.search_comparison);
  }

  function renderMemoryStats(summary) {
    bindDom();
    if (!els.memoryStats) {
      return;
    }
    els.memoryStats.innerHTML = '';
    if (!summary || typeof summary !== 'object') {
      setVisible(els.memoryStats, false);
      return;
    }
    MEMORY_STAT_DEFS.forEach(function (def) {
      const chip = document.createElement('div');
      chip.className = 'med-stat-chip ' + def.modifier;
      const count = summary[def.key] ?? 0;
      chip.innerHTML =
        '<span class="med-stat-chip__label">' + def.label + '</span>' +
        '<span class="med-stat-chip__value">' + count + '</span>';
      els.memoryStats.appendChild(chip);
    });
    setVisible(els.memoryStats, true);
  }

  function buildComparisonHintMarkup(activePointId) {
    const activeIndex = COMPARISON_STAGES.findIndex(function (stage) {
      return stage.pointId === activePointId;
    });
    const parts = COMPARISON_STAGES.map(function (stage, index) {
      const classes = ['med-comparison-stage'];
      if (index === activeIndex) {
        classes.push('med-comparison-stage--active');
      }
      if (activeIndex >= 0 && index < activeIndex) {
        classes.push('med-comparison-stage--past');
      }
      return '<span class="' + classes.join(' ') + '">' + stage.label + '</span>';
    });
    const arrows = parts.join('<span class="med-comparison-arrow" aria-hidden="true">→</span>');
    const activeStage = activeIndex >= 0 ? COMPARISON_STAGES[activeIndex] : null;
    const hintText = activeStage ? activeStage.hint : '';
    return (
      '<span class="med-comparison-track" aria-hidden="true">' + arrows + '</span>' +
      (hintText ? '<span class="med-comparison-caption">' + hintText + '</span>' : '')
    );
  }

  function updateComparisonHint(pointId) {
    bindDom();
    if (!els.comparisonHint) {
      return;
    }
    if (!isAnswerOverTime(currentScenarioId)) {
      setVisible(els.comparisonHint, false);
      els.comparisonHint.innerHTML = '';
      return;
    }
    els.comparisonHint.innerHTML = buildComparisonHintMarkup(pointId);
    setVisible(els.comparisonHint, viewState === 'ready');
  }

  function syncSegmentSelection(pointId) {
    bindDom();
    if (!els.pointSegment) {
      return;
    }
    const buttons = els.pointSegment.querySelectorAll('[data-point-id]');
    buttons.forEach(function (btn) {
      const selected = btn.getAttribute('data-point-id') === pointId;
      btn.classList.toggle('med-point-segment__btn--active', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
    });
  }

  function renderPointSegment(scenario) {
    bindDom();
    if (!els.pointSegment || !els.pointControls) {
      return;
    }
    els.pointSegment.innerHTML = '';
    const points = scenario && Array.isArray(scenario.points) ? scenario.points : [];
    const useSegment = isAnswerOverTime(scenario && scenario.scenario_id);

    setVisible(els.pointControls, points.length > 0);
    if (els.pointSegment) {
      els.pointSegment.hidden = !useSegment || points.length === 0;
    }
    if (els.pointSelectLabel) {
      els.pointSelectLabel.classList.toggle('hidden', useSegment);
    }

    if (!useSegment || points.length === 0) {
      return;
    }

    points.forEach(function (point, index) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'med-point-segment__btn';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-point-id', point.point_id);
      btn.setAttribute('aria-selected', 'false');
      btn.textContent = point.label || point.point_id;
      btn.addEventListener('click', function () {
        if (!els.pointSelect) {
          return;
        }
        els.pointSelect.value = point.point_id;
        syncSegmentSelection(point.point_id);
        onPointChange();
      });
      if (index === 0) {
        btn.tabIndex = 0;
      } else {
        btn.tabIndex = -1;
      }
      els.pointSegment.appendChild(btn);
    });
  }

  function renderSnapshot(snapshot, scenarioId) {
    bindDom();
    if (!bound || !snapshot) {
      return;
    }
    const activeScenarioId = scenarioId || currentScenarioId || (els.scenarioSelect ? els.scenarioSelect.value : '');
    updateScenarioLayout(activeScenarioId);
    if (els.question) {
      els.question.textContent = snapshot.question || '';
      els.question.classList.remove('med-placeholder');
    }
    if (els.answer) {
      els.answer.textContent = snapshot.answer || '';
      els.answer.classList.remove('med-placeholder');
    }
    renderMemoryStats(snapshot.memory_summary);
    if (els.memorySummary) {
      els.memorySummary.textContent = formatMemorySummaryText(snapshot.memory_summary);
      els.memorySummary.classList.remove('med-placeholder');
    }
    renderMemoryGroups(snapshot, activeScenarioId);
    if (els.explanationHeading) {
      els.explanationHeading.textContent = isConsolidation(activeScenarioId)
        ? '통합이 답변에 미치는 영향'
        : isForgettingPolicy(activeScenarioId)
          ? '왜 보존·망각이 갈리나요?'
          : '왜 답변이 달라지나요?';
    }
    if (els.explanationSection) {
      els.explanationSection.classList.toggle(
        'med-section--explanation-prominent',
        !isConsolidation(activeScenarioId)
      );
    }
    if (els.explanation) {
      els.explanation.textContent = snapshot.explanation || '';
      els.explanation.classList.remove('med-placeholder');
    }
    if (isConsolidation(activeScenarioId)) {
      renderConsolidationPanel(snapshot);
    } else {
      clearConsolidationPanel();
    }
    syncSegmentSelection(snapshot.point_id);
    setViewState('ready');
    updateComparisonHint(snapshot.point_id);
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
      renderPointSegment(scenario);
      return;
    }
    points.forEach(function (point) {
      const opt = document.createElement('option');
      opt.value = point.point_id;
      opt.textContent = point.label || point.point_id;
      select.appendChild(opt);
    });
    select.disabled = false;
    renderPointSegment(scenario);
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
      setVisible(els.pointControls, false);
      setVisible(els.comparisonHint, false);
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
    if (!canLoadFromApi()) {
      showAuthRequiredState();
      return Promise.resolve();
    }
    const fetchFn = getFetchFn();
    currentScenarioId = scenarioId || '';
    updateScenarioLayout(currentScenarioId);
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
    syncSegmentSelection(pointId);
    loadSnapshot(scenarioId, pointId);
  }

  function onScenarioChange() {
    bindDom();
    if (!els.scenarioSelect) {
      return;
    }
    const scenario = findScenario(els.scenarioSelect.value);
    currentScenarioId = scenario ? scenario.scenario_id : '';
    updateScenarioLayout(currentScenarioId);
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
    if (!canLoadFromApi()) {
      showAuthRequiredState();
      return Promise.resolve();
    }
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
        currentScenarioId = first.scenario_id;
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
    if (!canLoadFromApi()) {
      showAuthRequiredState();
      return Promise.resolve();
    }
    return loadScenarios();
  }

  function refresh() {
    bindDom();
    bindControls();
    if (!canLoadFromApi()) {
      showAuthRequiredState();
      return Promise.resolve();
    }
    return loadScenarios();
  }


  function onAuthStateChanged(nextState) {
    if (!isEvolutionTabActive()) {
      return;
    }
    if (nextState === 'signed-in') {
      refresh();
      return;
    }
    if (
      nextState === 'signed-out' ||
      nextState === 'checking' ||
      nextState === 'signing-in' ||
      nextState === 'signing-out'
    ) {
      showAuthRequiredState();
    }
  }

  function init() {
    bindDom();
    if (!canLoadFromApi()) {
      showAuthRequiredState();
      return;
    }
    setViewState(viewState);
  }

  global.__MEMENTO_EVOLUTION_DEMO_SHELL__ = {
    init: init,
    initPanel: initPanel,
    refresh: refresh,
    showAuthRequiredState: showAuthRequiredState,
    onAuthStateChanged: onAuthStateChanged,
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
