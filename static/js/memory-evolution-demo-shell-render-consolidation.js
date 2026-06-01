/**
 * Memory evolution demo - render consolidation helpers (#450).
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;

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

  ns.renderEpisodicSources = renderEpisodicSources;
  ns.renderSemanticResult = renderSemanticResult;
  ns.renderSearchComparison = renderSearchComparison;
  ns.renderConsolidationPanel = renderConsolidationPanel;
})(typeof window !== 'undefined' ? window : globalThis);
