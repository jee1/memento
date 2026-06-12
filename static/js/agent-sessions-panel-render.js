/**
 * Agent session dashboard safe renderers (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

  function number(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : '0';
  }

  function setCount(id, value) {
    const element = ns.$(id);
    if (element) {
      element.textContent = number(value);
    }
  }

  function addBadge(parent, label, modifier) {
    return ns.appendText(parent, 'span', label, 'as-state-badge as-state-badge--' + modifier);
  }

  function addDefinition(list, term, value) {
    const row = document.createElement('div');
    ns.appendText(row, 'dt', term);
    ns.appendText(row, 'dd', value == null || value === '' ? '—' : String(value));
    list.appendChild(row);
  }

  function sessionAggregate(session) {
    return session.aggregate || session.observation_aggregate || {};
  }

  ns.renderAggregate = function (aggregate) {
    setCount('as-count-sessions', aggregate.sessions_total ?? aggregate.total);
    setCount('as-count-observations', aggregate.observations_total);
    setCount('as-count-redacted', aggregate.redacted_total ?? aggregate.redacted);
    setCount('as-count-dropped', aggregate.dropped_total ?? aggregate.dropped);
    setCount('as-count-degraded', aggregate.degraded_total ?? aggregate.degraded);
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
      addBadge(heading, session.status || 'unknown', session.status || 'unknown');
      button.appendChild(heading);
      ns.appendText(button, 'span', session.id || session.session_id, 'as-mono');
      ns.appendText(
        button,
        'span',
        ns.formatTime(session.last_event_at || session.updated_at || session.started_at),
        'as-muted',
      );
      const aggregate = sessionAggregate(session);
      ns.appendText(
        button,
        'span',
        number(aggregate.total) +
          ' events · ' +
          number(aggregate.redacted) +
          ' redacted · ' +
          number(aggregate.dropped) +
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
    addDefinition(list, 'Session', session.id || session.session_id);
    addDefinition(list, 'Status', session.status);
    addDefinition(list, 'Adapter', session.adapter_name || session.adapter);
    addDefinition(list, 'Owner', session.owner_id);
    addDefinition(list, 'Project', session.project_id);
    addDefinition(list, 'Started', ns.formatTime(session.started_at));
    addDefinition(list, 'Last event', ns.formatTime(session.last_event_at || session.updated_at));
    detail.appendChild(list);
    if (session.degraded || session.status === 'degraded') {
      addBadge(detail, session.degraded_reason || 'degraded', 'degraded');
    }
  };

  function eventCategory(observation) {
    if (observation.event_category) {
      return observation.event_category;
    }
    const type = String(observation.event_type || '').toUpperCase();
    if (type.includes('PROMPT')) return 'prompt';
    if (type.includes('TOOL_CALL') || type === 'TOOL') return 'tool';
    if (type.includes('TOOL_RESULT') || type.includes('RESULT')) return 'result';
    if (type.includes('ERROR') || type.includes('FAIL')) return 'error';
    if (type.includes('RESPONSE') || type.includes('ASSISTANT')) return 'response';
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
      addBadge(item, status, status);
      if (observation.redacted || status === 'redacted' || Number(observation.redaction_count) > 0) {
        addBadge(
          item,
          'redacted ' + number(observation.redaction_count) + ' field(s)',
          'redacted',
        );
      }
      if (observation.dropped || status === 'dropped') {
        addBadge(item, observation.drop_reason || observation.reason_code || 'dropped', 'dropped');
      }
      if (observation.degraded || status === 'degraded') {
        addBadge(
          item,
          observation.degraded_reason || observation.reason_code || 'degraded',
          'degraded',
        );
      }
      if (observation.late) {
        addBadge(item, 'late', 'late');
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

  ns.renderInjections = function (injections) {
    const container = ns.$('as-injections');
    if (!container) {
      return;
    }
    ns.clearNode(container);
    if (!injections.length) {
      ns.appendText(container, 'p', 'No injection decisions recorded.', 'as-placeholder');
      return;
    }
    injections.forEach(function (injection) {
      const card = document.createElement('article');
      card.className = 'as-injection';
      ns.appendText(card, 'strong', injection.injection_id || injection.request_id || 'Injection');
      ns.appendText(
        card,
        'span',
        'Tokens ' +
          number(injection.token_used) +
          ' / ' +
          number(injection.token_budget) +
          ' · ' +
          (injection.status || 'unknown'),
        'as-muted',
      );
      const candidates = Array.isArray(injection.candidates) ? injection.candidates : [];
      candidates.forEach(function (candidate) {
        const row = document.createElement('div');
        row.className = 'as-candidate';
        ns.appendText(row, 'span', candidate.memory_id || 'Unknown memory', 'as-mono');
        ns.appendText(
          row,
          'span',
          'score ' +
            number(candidate.score) +
            ' · tokens ' +
            number(candidate.token_estimate) +
            ' · ' +
            (candidate.used ? 'used' : candidate.decision || 'excluded'),
        );
        if (candidate.used) {
          addBadge(row, 'used', 'used');
        }
        const trace = document.createElement('button');
        trace.type = 'button';
        trace.className = 'm-button m-button--ghost';
        trace.textContent = 'Trace';
        trace.addEventListener('click', function () {
          void ns.loadProvenance('memory_id', candidate.memory_id).catch(ns.showError);
        });
        row.appendChild(trace);
        card.appendChild(row);
      });
      container.appendChild(card);
    });
  };

  ns.renderProvenance = function (detail) {
    const container = ns.$('as-provenance-results');
    if (!container) {
      return;
    }
    ns.clearNode(container);
    ['memories', 'observations', 'sessions'].forEach(function (key) {
      const items = Array.isArray(detail[key]) ? detail[key] : [];
      const group = document.createElement('section');
      group.className = 'as-provenance-group';
      ns.appendText(group, 'h4', key);
      if (!items.length) {
        ns.appendText(group, 'p', 'Unavailable or source_deleted.', 'as-placeholder');
      }
      items.forEach(function (item) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'as-provenance-item';
        const id = item.id || item.memory_id || item.observation_id || item.session_id;
        ns.appendText(row, 'strong', id || 'Unavailable');
        ns.appendText(
          row,
          'span',
          item.content_preview || item.event_type || item.status || 'safe metadata only',
          'as-muted',
        );
        if (key === 'sessions' && id) {
          row.addEventListener('click', function () {
            void ns.selectSession(id).catch(ns.showError);
          });
        }
        group.appendChild(row);
      });
      container.appendChild(group);
    });
  };

  ns.showError = function (error) {
    ns.setViewState('error', error instanceof Error ? error.message : 'Agent Sessions failed.');
  };
})(typeof window !== 'undefined' ? window : globalThis);
