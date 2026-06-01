/**
 * Memory evolution demo - render timeline helpers (#450).
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;

  function buildComparisonHintMarkup(activePointId) {
    const activeIndex = ns.COMPARISON_STAGES.findIndex(function (stage) {
      return stage.pointId === activePointId;
    });
    const parts = ns.COMPARISON_STAGES.map(function (stage, index) {
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
    const activeStage = activeIndex >= 0 ? ns.COMPARISON_STAGES[activeIndex] : null;
    const hintText = activeStage ? activeStage.hint : '';
    return (
      '<span class="med-comparison-track" aria-hidden="true">' + arrows + '</span>' +
      (hintText ? '<span class="med-comparison-caption">' + hintText + '</span>' : '')
    );
  }

  function updateComparisonHint(pointId) {
    ns.bindDom();
    const els = ns.els;
    if (!els.comparisonHint) {
      return;
    }
    if (!ns.isAnswerOverTime(ns.currentScenarioId)) {
      ns.setVisible(els.comparisonHint, false);
      els.comparisonHint.innerHTML = '';
      return;
    }
    els.comparisonHint.innerHTML = buildComparisonHintMarkup(pointId);
    ns.setVisible(els.comparisonHint, ns.viewState === 'ready');
  }

  function syncSegmentSelection(pointId) {
    ns.bindDom();
    const els = ns.els;
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
    ns.bindDom();
    const els = ns.els;
    if (!els.pointSegment || !els.pointControls) {
      return;
    }
    els.pointSegment.innerHTML = '';
    const points = scenario && Array.isArray(scenario.points) ? scenario.points : [];
    const useSegment = ns.isAnswerOverTime(scenario && scenario.scenario_id);

    ns.setVisible(els.pointControls, points.length > 0);
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
        if (typeof ns.onPointChange === 'function') {
          ns.onPointChange();
        }
      });
      if (index === 0) {
        btn.tabIndex = 0;
      } else {
        btn.tabIndex = -1;
      }
      els.pointSegment.appendChild(btn);
    });
  }

  ns.updateComparisonHint = updateComparisonHint;
  ns.syncSegmentSelection = syncSegmentSelection;
  ns.renderPointSegment = renderPointSegment;
})(typeof window !== 'undefined' ? window : globalThis);
