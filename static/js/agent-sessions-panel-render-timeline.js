/**
 * Agent session dashboard timeline renderers (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  const dom = ns && ns.renderDom;
  if (!ns || !dom) {
    return;
  }

  function eventCategory(observation) {
    if (typeof ns.eventCategory === 'function') {
      return ns.eventCategory(observation);
    }
    return 'lifecycle';
  }

  ns.renderTimeline = function (observations, append) {
    const timeline = ns.$('as-timeline');
    if (!timeline) {
      return;
    }
    if (!append) {
      ns.clearNode(timeline);
    }
    observations.forEach(function (observation) {
      const category = eventCategory(observation);
      const item = document.createElement('li');
      item.className = 'as-event as-event--' + category;
      const header = document.createElement('div');
      header.className = 'as-event__header';
      ns.appendText(header, 'strong', observation.event_type || category);
      ns.appendText(
        header,
        'time',
        ns.formatTime(observation.occurred_at || observation.received_at),
      );
      item.appendChild(header);
      ns.appendText(item, 'span', observation.id || observation.observation_id, 'as-mono');
      const status = String(observation.status || 'accepted').toLowerCase();
      dom.addBadge(item, status, status);
      if (observation.redacted || status === 'redacted' || Number(observation.redaction_count) > 0) {
        dom.addBadge(
          item,
          'redacted ' + dom.number(observation.redaction_count) + ' field(s)',
          'redacted',
        );
      }
      if (observation.dropped || status === 'dropped') {
        dom.addBadge(item, observation.drop_reason || observation.reason_code || 'dropped', 'dropped');
      }
      if (observation.degraded || status === 'degraded') {
        dom.addBadge(
          item,
          observation.degraded_reason || observation.reason_code || 'degraded',
          'degraded',
        );
      }
      if (observation.late) {
        dom.addBadge(item, 'late', 'late');
      }
      const trace = document.createElement('button');
      trace.type = 'button';
      trace.className = 'm-button m-button--ghost as-event__trace';
      trace.textContent = 'Trace provenance';
      trace.addEventListener('click', function () {
        void ns
          .loadProvenance('observation_id', observation.id || observation.observation_id)
          .catch(ns.showError);
      });
      item.appendChild(trace);
      timeline.appendChild(item);
    });
    if (!timeline.childElementCount) {
      ns.appendText(timeline, 'li', 'No observations match the current filters.', 'as-placeholder');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
