/**
 * Agent session dashboard session list/detail renderers (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  const dom = ns && ns.renderDom;
  if (!ns || !dom) {
    return;
  }

  ns.renderAggregate = function (aggregate) {
    dom.setCount('as-count-sessions', aggregate.sessions_total ?? aggregate.total);
    dom.setCount('as-count-observations', aggregate.observations_total);
    dom.setCount('as-count-redacted', aggregate.redacted_total ?? aggregate.redacted);
    dom.setCount('as-count-dropped', aggregate.dropped_total ?? aggregate.dropped);
    dom.setCount('as-count-degraded', aggregate.degraded_total ?? aggregate.degraded);
  };

  ns.renderSessions = function (sessions, append) {
    const list = ns.$('as-session-list');
    if (!list) {
      return;
    }
    if (!append) {
      ns.clearNode(list);
    }
    sessions.forEach(function (session) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'as-session-item';
      button.dataset.sessionId = String(session.id || session.session_id || '');
      button.addEventListener('click', function () {
        void ns.selectSession(button.dataset.sessionId).catch(ns.showError);
      });
      const heading = document.createElement('span');
      heading.className = 'as-session-item__heading';
      ns.appendText(heading, 'strong', session.adapter_name || session.adapter || 'Unknown adapter');
      dom.addBadge(heading, session.status || 'unknown', session.status || 'unknown');
      button.appendChild(heading);
      ns.appendText(button, 'span', session.id || session.session_id, 'as-mono');
      ns.appendText(
        button,
        'span',
        ns.formatTime(session.last_event_at || session.updated_at || session.started_at),
        'as-muted',
      );
      const aggregate = dom.sessionAggregate(session);
      ns.appendText(
        button,
        'span',
        dom.number(aggregate.total) +
          ' events · ' +
          dom.number(aggregate.redacted) +
          ' redacted · ' +
          dom.number(aggregate.dropped) +
          ' dropped',
        'as-muted',
      );
      list.appendChild(button);
    });
  };

  ns.renderSessionSelection = function (sessionId) {
    document.querySelectorAll('.as-session-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.sessionId === sessionId);
    });
  };

  ns.renderSessionDetail = function (session) {
    const detail = ns.$('as-session-detail');
    if (!detail) {
      return;
    }
    ns.clearNode(detail);
    ns.appendText(detail, 'h3', 'Session detail');
    const list = document.createElement('dl');
    list.className = 'as-detail-list';
    dom.addDefinition(list, 'Session', session.id || session.session_id);
    dom.addDefinition(list, 'Status', session.status);
    dom.addDefinition(list, 'Adapter', session.adapter_name || session.adapter);
    dom.addDefinition(list, 'Owner', session.owner_id);
    dom.addDefinition(list, 'Project', session.project_id);
    dom.addDefinition(list, 'Started', ns.formatTime(session.started_at));
    dom.addDefinition(list, 'Last event', ns.formatTime(session.last_event_at || session.updated_at));
    detail.appendChild(list);
    if (session.degraded || session.status === 'degraded') {
      dom.addBadge(detail, session.degraded_reason || 'degraded', 'degraded');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
