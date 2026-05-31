/**
 * Memory evolution demo — shared constants, state, DOM, auth, and fetch helpers (#445).
 */
(function (global) {
  'use strict';

  const shell = (global.__MEMENTO_EVOLUTION_DEMO_SHELL__ =
    global.__MEMENTO_EVOLUTION_DEMO_SHELL__ || {});
  const ns = (shell.internal = shell.internal || {});

  ns.SCENARIOS_URL = '/admin/evolution-demo/scenarios';
  ns.SNAPSHOT_URL_PREFIX = '/admin/evolution-demo/snapshots/';
  ns.VALID_STATES = ['loading', 'empty', 'error', 'ready'];
  ns.EMPTY_MESSAGE_SIGNED_OUT =
    '관리자 API 키로 로그인하면 시뮬레이션 데이터를 불러올 수 있습니다.';
  ns.EMPTY_MESSAGE_CHECKING =
    '대시보드 세션을 확인하는 중입니다. 로그인 후 데모 API 데이터를 불러올 수 있습니다.';
  ns.ANSWER_OVER_TIME_ID = 'answer-over-time';
  ns.FORGETTING_POLICY_ID = 'forgetting-policy';
  ns.CONSOLIDATION_ID = 'episodic-to-semantic';

  ns.OUTCOME_LABELS = {
    forget: '망각',
    preserve: '보존 (semantic)',
    pin: '핀 고정',
  };

  ns.COMPARISON_STAGES = [
    { pointId: 'early', label: '상세', hint: '회의·결정 맥락이 그대로 드러나는 episodic 중심 답변' },
    { pointId: 'mid', label: '압축', hint: '망각·통합으로 잡음이 걸러지고 핵심만 남은 답변' },
    { pointId: 'late', label: 'semantic 중심', hint: '사실이 semantic 기억으로 응축된 한 줄 답변' },
  ];

  ns.MEMORY_STAT_DEFS = [
    { key: 'episodic_count', label: '에피소딕', modifier: 'med-stat-chip--episodic' },
    { key: 'semantic_count', label: '시맨틱', modifier: 'med-stat-chip--semantic' },
    { key: 'forgotten_count', label: '망각', modifier: 'med-stat-chip--forgotten' },
    { key: 'preserved_count', label: '보존', modifier: 'med-stat-chip--preserved' },
  ];

  ns.viewState = 'loading';
  ns.bound = false;
  ns.panelInitialized = false;
  ns.scenarios = [];
  ns.loadGeneration = 0;
  ns.currentScenarioId = '';

  ns.els = {
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
    if (ns.bound) {
      return;
    }
    const els = ns.els;
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
    ns.bound = Boolean(
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

  function setVisible(el, visible) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', !visible);
  }

  function isForgettingPolicy(scenarioId) {
    return scenarioId === ns.FORGETTING_POLICY_ID;
  }

  function isAnswerOverTime(scenarioId) {
    return scenarioId === ns.ANSWER_OVER_TIME_ID;
  }

  function isConsolidation(scenarioId) {
    return scenarioId === ns.CONSOLIDATION_ID;
  }

  function formatImportance(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '—';
    }
    return Math.round(value * 100) + '%';
  }

  function formatMemorySummaryText(summary) {
    if (!summary || typeof summary !== 'object' || isConsolidation(ns.currentScenarioId)) {
      return '';
    }
    return typeof summary.summary_text === 'string' ? summary.summary_text.trim() : '';
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

  function clearConsolidationPanel() {
    bindDom();
    const els = ns.els;
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

  function updateScenarioLayout(scenarioId) {
    bindDom();
    const els = ns.els;
    const consolidation = isConsolidation(scenarioId);
    setVisible(els.consolidationPanel, consolidation);
    setVisible(els.standardPanels, !consolidation);
    if (!consolidation) {
      clearConsolidationPanel();
    }
  }

  function findScenario(scenarioId) {
    return ns.scenarios.find(function (s) {
      return s.scenario_id === scenarioId;
    });
  }

  function setViewState(state) {
    if (ns.VALID_STATES.indexOf(state) < 0) {
      return;
    }
    bindDom();
    if (!ns.bound) {
      return;
    }
    const els = ns.els;
    ns.viewState = state;
    setVisible(els.loading, state === 'loading');
    setVisible(els.empty, state === 'empty');
    setVisible(els.error, state === 'error');
    setVisible(els.content, state === 'ready');
    if (state !== 'ready') {
      setVisible(els.comparisonHint, false);
    } else if (els.comparisonHint && isAnswerOverTime(ns.currentScenarioId)) {
      setVisible(els.comparisonHint, els.comparisonHint.innerHTML.trim() !== '');
    }
  }

  function setErrorMessage(message) {
    bindDom();
    if (ns.els.error) {
      ns.els.error.textContent = message || '데모 데이터를 불러오지 못했습니다.';
    }
  }

  function showAuthRequiredState() {
    bindDom();
    if (!ns.bound) {
      return;
    }
    const authState = getAuthState();
    if (ns.els.empty) {
      ns.els.empty.textContent =
        authState === 'checking' ? ns.EMPTY_MESSAGE_CHECKING : ns.EMPTY_MESSAGE_SIGNED_OUT;
    }
    if (ns.els.scenarioSelect) {
      ns.els.scenarioSelect.disabled = true;
    }
    if (ns.els.pointSelect) {
      ns.els.pointSelect.disabled = true;
    }
    setViewState('empty');
  }

  ns.bindDom = bindDom;
  ns.getAuthState = getAuthState;
  ns.canLoadFromApi = canLoadFromApi;
  ns.isEvolutionTabActive = isEvolutionTabActive;
  ns.setVisible = setVisible;
  ns.setViewState = setViewState;
  ns.setErrorMessage = setErrorMessage;
  ns.showAuthRequiredState = showAuthRequiredState;
  ns.getFetchFn = getFetchFn;
  ns.parseJsonResponse = parseJsonResponse;
  ns.readErrorFromBody = readErrorFromBody;
  ns.isForgettingPolicy = isForgettingPolicy;
  ns.isAnswerOverTime = isAnswerOverTime;
  ns.isConsolidation = isConsolidation;
  ns.formatImportance = formatImportance;
  ns.formatMemorySummaryText = formatMemorySummaryText;
  ns.formatDate = formatDate;
  ns.clearConsolidationPanel = clearConsolidationPanel;
  ns.updateScenarioLayout = updateScenarioLayout;
  ns.findScenario = findScenario;
})(typeof window !== 'undefined' ? window : globalThis);
