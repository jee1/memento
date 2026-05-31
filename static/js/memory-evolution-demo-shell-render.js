/**
 * Memory evolution demo — render helpers (#445).
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;

  function renderMemoryGroups(snapshot, scenarioId) {
    ns.bindDom();
    const els = ns.els;
    const showGroups =
      ns.isForgettingPolicy(scenarioId) &&
      snapshot &&
      Array.isArray(snapshot.memory_groups) &&
      snapshot.memory_groups.length > 0;

    if (els.memoryGroupsSection) {
      ns.setVisible(els.memoryGroupsSection, showGroups);
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
        ns.formatImportance(group.importance) +
        (group.pinned ? ' · 핀 고정' : '');

      const status = document.createElement('p');
      status.className = 'med-memory-group-card__status';
      status.textContent = group.status || '';

      const outcomeEl = document.createElement('p');
      outcomeEl.className =
        'med-memory-group-card__outcome med-memory-group-card__outcome--' + outcome;
      outcomeEl.textContent = ns.OUTCOME_LABELS[outcome] || outcome;

      card.appendChild(label);
      card.appendChild(meta);
      card.appendChild(status);
      card.appendChild(outcomeEl);
      els.memoryGroups.appendChild(card);
    });
  }

  function renderEpisodicSources(sources) {
    ns.bindDom();
    const els = ns.els;
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
      const created = source && ns.formatDate(source.created_at);
      if (created) {
        metaParts.push(created);
      }
      const importance = source && ns.formatImportance(source.importance);
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
    ns.bindDom();
    const els = ns.els;
    if (!els.semanticResultSection || !els.semanticResultCard) {
      return;
    }
    els.semanticResultCard.innerHTML = '';
    if (!result || typeof result !== 'object') {
      ns.setVisible(els.semanticResultSection, false);
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
    ns.setVisible(els.semanticResultSection, true);
  }

  function renderSearchComparison(comparison) {
    ns.bindDom();
    const els = ns.els;
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
    ns.bindDom();
    if (!ns.isConsolidation(ns.currentScenarioId)) {
      ns.clearConsolidationPanel();
      return;
    }
    renderEpisodicSources(snapshot && snapshot.episodic_sources);
    renderSemanticResult(snapshot && snapshot.semantic_result);
    renderSearchComparison(snapshot && snapshot.search_comparison);
  }

  function renderMemoryStats(summary) {
    ns.bindDom();
    const els = ns.els;
    if (!els.memoryStats) {
      return;
    }
    els.memoryStats.innerHTML = '';
    if (!summary || typeof summary !== 'object') {
      ns.setVisible(els.memoryStats, false);
      return;
    }
    ns.MEMORY_STAT_DEFS.forEach(function (def) {
      const chip = document.createElement('div');
      chip.className = 'med-stat-chip ' + def.modifier;
      const count = summary[def.key] ?? 0;
      chip.innerHTML =
        '<span class="med-stat-chip__label">' + def.label + '</span>' +
        '<span class="med-stat-chip__value">' + count + '</span>';
      els.memoryStats.appendChild(chip);
    });
    ns.setVisible(els.memoryStats, true);
  }

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

  function renderSnapshot(snapshot, scenarioId) {
    ns.bindDom();
    const els = ns.els;
    if (!ns.bound || !snapshot) {
      return;
    }
    const activeScenarioId =
      scenarioId || ns.currentScenarioId || (els.scenarioSelect ? els.scenarioSelect.value : '');
    ns.updateScenarioLayout(activeScenarioId);
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
      els.memorySummary.textContent = ns.formatMemorySummaryText(snapshot.memory_summary);
      els.memorySummary.classList.remove('med-placeholder');
    }
    renderMemoryGroups(snapshot, activeScenarioId);
    if (els.explanationHeading) {
      els.explanationHeading.textContent = ns.isConsolidation(activeScenarioId)
        ? '통합이 답변에 미치는 영향'
        : ns.isForgettingPolicy(activeScenarioId)
          ? '왜 보존·망각이 갈리나요?'
          : '왜 답변이 달라지나요?';
    }
    if (els.explanationSection) {
      els.explanationSection.classList.toggle(
        'med-section--explanation-prominent',
        !ns.isConsolidation(activeScenarioId)
      );
    }
    if (els.explanation) {
      els.explanation.textContent = snapshot.explanation || '';
      els.explanation.classList.remove('med-placeholder');
    }
    if (ns.isConsolidation(activeScenarioId)) {
      renderConsolidationPanel(snapshot);
    } else {
      ns.clearConsolidationPanel();
    }
    syncSegmentSelection(snapshot.point_id);
    ns.setViewState('ready');
    updateComparisonHint(snapshot.point_id);
  }

  ns.renderMemoryGroups = renderMemoryGroups;
  ns.renderEpisodicSources = renderEpisodicSources;
  ns.renderSemanticResult = renderSemanticResult;
  ns.renderSearchComparison = renderSearchComparison;
  ns.renderConsolidationPanel = renderConsolidationPanel;
  ns.renderMemoryStats = renderMemoryStats;
  ns.updateComparisonHint = updateComparisonHint;
  ns.syncSegmentSelection = syncSegmentSelection;
  ns.renderPointSegment = renderPointSegment;
  ns.renderSnapshot = renderSnapshot;
})(typeof window !== 'undefined' ? window : globalThis);
