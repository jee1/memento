/**
 * Memory evolution demo - data loading, controls, and panel lifecycle (#445).
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;

  function populatePointSelect(scenario) {
    ns.bindDom();
    const els = ns.els;
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
      ns.renderPointSegment(scenario);
      return;
    }
    points.forEach(function (point) {
      const opt = document.createElement('option');
      opt.value = point.point_id;
      opt.textContent = point.label || point.point_id;
      select.appendChild(opt);
    });
    select.disabled = false;
    ns.renderPointSegment(scenario);
  }

  function populateScenarioSelect(catalog) {
    ns.bindDom();
    const els = ns.els;
    if (!els.scenarioSelect) {
      return null;
    }
    const select = els.scenarioSelect;
    select.innerHTML = '';
    ns.scenarios = catalog && Array.isArray(catalog.scenarios) ? catalog.scenarios : [];
    if (ns.scenarios.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '사용 가능한 시나리오 없음';
      select.appendChild(opt);
      select.disabled = true;
      if (els.pointSelect) {
        els.pointSelect.innerHTML = '<option value="">시점 선택</option>';
        els.pointSelect.disabled = true;
      }
      ns.setVisible(els.pointControls, false);
      ns.setVisible(els.comparisonHint, false);
      return null;
    }
    ns.scenarios.forEach(function (scenario) {
      const opt = document.createElement('option');
      opt.value = scenario.scenario_id;
      opt.textContent = scenario.title || scenario.scenario_id;
      select.appendChild(opt);
    });
    select.disabled = false;
    return ns.scenarios[0];
  }

  function loadSnapshot(scenarioId, pointId) {
    if (!ns.canLoadFromApi()) {
      ns.showAuthRequiredState();
      return Promise.resolve();
    }
    const fetchFn = ns.getFetchFn();
    ns.currentScenarioId = scenarioId || '';
    ns.updateScenarioLayout(ns.currentScenarioId);
    if (!fetchFn) {
      ns.setErrorMessage('mementoAdminFetch를 사용할 수 없습니다.');
      ns.setViewState('error');
      return Promise.resolve();
    }
    if (!scenarioId || !pointId) {
      ns.setViewState('empty');
      return Promise.resolve();
    }

    const generation = ++ns.loadGeneration;
    ns.setViewState('loading');

    const url =
      ns.SNAPSHOT_URL_PREFIX +
      encodeURIComponent(scenarioId) +
      '/' +
      encodeURIComponent(pointId);
    return fetchFn(url, { headers: { Accept: 'application/json' } })
      .then(ns.parseJsonResponse)
      .then(function (result) {
        if (generation !== ns.loadGeneration) {
          return;
        }
        if (!result.ok) {
          ns.setErrorMessage(
            ns.readErrorFromBody(result.body, '스냅샷 조회 실패 (HTTP ' + result.status + ')')
          );
          ns.setViewState('error');
          return;
        }
        ns.renderSnapshot(result.body, scenarioId);
      })
      .catch(function (err) {
        if (generation !== ns.loadGeneration) {
          return;
        }
        ns.setErrorMessage(
          err && err.message ? err.message : '스냅샷 조회 중 오류가 발생했습니다.'
        );
        ns.setViewState('error');
      });
  }

  function onPointChange() {
    ns.bindDom();
    const els = ns.els;
    if (!els.scenarioSelect || !els.pointSelect) {
      return;
    }
    const scenarioId = els.scenarioSelect.value;
    const pointId = els.pointSelect.value;
    ns.syncSegmentSelection(pointId);
    loadSnapshot(scenarioId, pointId);
  }

  function onScenarioChange() {
    ns.bindDom();
    const els = ns.els;
    if (!els.scenarioSelect) {
      return;
    }
    const scenario = ns.findScenario(els.scenarioSelect.value);
    ns.currentScenarioId = scenario ? scenario.scenario_id : '';
    ns.updateScenarioLayout(ns.currentScenarioId);
    populatePointSelect(scenario);
    if (scenario && scenario.points && scenario.points.length > 0) {
      if (els.pointSelect) {
        els.pointSelect.value = scenario.points[0].point_id;
      }
      loadSnapshot(scenario.scenario_id, scenario.points[0].point_id);
    } else {
      ns.setViewState('empty');
    }
  }

  function bindControls() {
    ns.bindDom();
    if (!ns.bound || ns.panelInitialized) {
      return;
    }
    const els = ns.els;
    if (els.scenarioSelect) {
      els.scenarioSelect.addEventListener('change', onScenarioChange);
    }
    if (els.pointSelect) {
      els.pointSelect.addEventListener('change', onPointChange);
    }
    ns.panelInitialized = true;
  }

  function loadScenarios() {
    if (!ns.canLoadFromApi()) {
      ns.showAuthRequiredState();
      return Promise.resolve();
    }
    const fetchFn = ns.getFetchFn();
    if (!fetchFn) {
      ns.setErrorMessage('mementoAdminFetch를 사용할 수 없습니다.');
      ns.setViewState('error');
      return Promise.resolve();
    }

    const generation = ++ns.loadGeneration;
    ns.setViewState('loading');

    return fetchFn(ns.SCENARIOS_URL, { headers: { Accept: 'application/json' } })
      .then(ns.parseJsonResponse)
      .then(function (result) {
        if (generation !== ns.loadGeneration) {
          return;
        }
        if (!result.ok) {
          ns.setErrorMessage(
            ns.readErrorFromBody(result.body, '시나리오 목록 조회 실패 (HTTP ' + result.status + ')')
          );
          ns.setViewState('error');
          return;
        }
        const first = populateScenarioSelect(result.body);
        if (!first) {
          ns.setViewState('empty');
          return;
        }
        ns.currentScenarioId = first.scenario_id;
        populatePointSelect(first);
        const els = ns.els;
        if (els.scenarioSelect) {
          els.scenarioSelect.value = first.scenario_id;
        }
        if (els.pointSelect && first.points && first.points.length > 0) {
          els.pointSelect.value = first.points[0].point_id;
          return loadSnapshot(first.scenario_id, first.points[0].point_id);
        }
        ns.setViewState('empty');
      })
      .catch(function (err) {
        if (generation !== ns.loadGeneration) {
          return;
        }
        ns.setErrorMessage(
          err && err.message ? err.message : '시나리오 목록 조회 중 오류가 발생했습니다.'
        );
        ns.setViewState('error');
      });
  }

  function initPanel() {
    ns.bindDom();
    bindControls();
    if (!ns.canLoadFromApi()) {
      ns.showAuthRequiredState();
      return Promise.resolve();
    }
    return loadScenarios();
  }

  function refresh() {
    ns.bindDom();
    bindControls();
    if (!ns.canLoadFromApi()) {
      ns.showAuthRequiredState();
      return Promise.resolve();
    }
    return loadScenarios();
  }

  function onAuthStateChanged(nextState) {
    if (!ns.isEvolutionTabActive()) {
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
      ns.showAuthRequiredState();
    }
  }

  ns.onPointChange = onPointChange;
  ns.populatePointSelect = populatePointSelect;
  ns.populateScenarioSelect = populateScenarioSelect;
  ns.loadSnapshot = loadSnapshot;
  ns.onScenarioChange = onScenarioChange;
  ns.bindControls = bindControls;
  ns.loadScenarios = loadScenarios;
  ns.initPanel = initPanel;
  ns.refresh = refresh;
  ns.onAuthStateChanged = onAuthStateChanged;
})(typeof window !== 'undefined' ? window : globalThis);
