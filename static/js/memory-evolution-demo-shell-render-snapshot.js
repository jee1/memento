/**
 * Memory evolution demo - render snapshot helpers (#450).
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
      ns.renderConsolidationPanel(snapshot);
    } else {
      ns.clearConsolidationPanel();
    }
    ns.syncSegmentSelection(snapshot.point_id);
    ns.setViewState('ready');
    ns.updateComparisonHint(snapshot.point_id);
  }

  ns.renderMemoryGroups = renderMemoryGroups;
  ns.renderMemoryStats = renderMemoryStats;
  ns.renderSnapshot = renderSnapshot;
})(typeof window !== 'undefined' ? window : globalThis);
