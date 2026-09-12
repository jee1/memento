/**
 * Agent session dashboard injection renderers (#460, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  const dom = ns && ns.renderDom;
  if (!ns || !dom) {
    return;
  }

  ns.renderInjections = function (injections) {
    const container = ns.$('as-injections');
    if (!container) {
      return;
    }
    ns.clearNode(container);
    if (!injections.length) {
      ns.appendText(container, 'p', '기록된 주입 결정이 없습니다.', 'as-placeholder');
      return;
    }
    injections.forEach(function (injection) {
      const card = document.createElement('article');
      card.className = 'as-injection';
      ns.appendText(card, 'strong', injection.injection_id || injection.request_id || '주입');
      ns.appendText(
        card,
        'span',
        '토큰 ' +
          dom.number(injection.token_used) +
          ' / ' +
          dom.number(injection.token_budget) +
          ' · ' +
          (injection.status || 'unknown'),
        'as-muted',
      );
      const candidates = Array.isArray(injection.candidates) ? injection.candidates : [];
      candidates.forEach(function (candidate) {
        const row = document.createElement('div');
        row.className = 'as-candidate';
        ns.appendText(row, 'span', candidate.memory_id || '알 수 없는 기억', 'as-mono');
        ns.appendText(
          row,
          'span',
          'score ' +
            dom.number(candidate.score) +
            ' · tokens ' +
            dom.number(candidate.token_estimate) +
            ' · ' +
            (candidate.used ? 'selected' : candidate.decision || 'excluded') +
            (candidate.reason || candidate.reason_code
              ? ' · reason ' + (candidate.reason || candidate.reason_code)
              : ''),
        );
        if (candidate.used) {
          dom.addBadge(row, 'used', 'used');
        }
        const trace = document.createElement('button');
        trace.type = 'button';
        trace.className = 'm-button m-button--ghost';
        trace.textContent = '추적';
        trace.addEventListener('click', function () {
          void ns.loadProvenance('memory_id', candidate.memory_id).catch(ns.showError);
        });
        row.appendChild(trace);
        card.appendChild(row);
      });
      container.appendChild(card);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
