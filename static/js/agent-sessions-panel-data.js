/**
 * Agent session dashboard API reads (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

  function value(id) {
    const element = ns.$(id);
    return element ? element.value.trim() : '';
  }

  async function loadSessions(append) {
    const generation = ++ns.state.loadGeneration;
    if (!append) {
      ns.state.sessionCursor = null;
      ns.setViewState('loading', 'Loading agent sessions…');
    }
    const body = await ns.agentFetch(
      '/api/v1/agent/sessions' +
        ns.queryString({
          cursor: append ? ns.state.sessionCursor : null,
          limit: 25,
          status: value('as-session-status'),
          adapter: value('as-session-adapter'),
          owner_id: value('as-session-owner'),
          project_id: value('as-session-project'),
        }),
    );
    if (generation !== ns.state.loadGeneration) {
      return;
    }
    const rawSessions = Array.isArray(body.sessions)
      ? body.sessions
      : Array.isArray(body.items)
        ? body.items
        : [];
    const sessions = rawSessions.map(function (item) {
      if (item && item.session) {
        return Object.assign({}, item.session, {
          aggregate: item.aggregate || item.observation_aggregate || {},
        });
      }
      return item;
    });
    ns.state.sessionCursor = body.next_cursor || null;
    ns.renderSessions(sessions, append);
    ns.renderAggregate(body.aggregate || {});
    ns.setHidden(ns.$('as-load-more-sessions'), !ns.state.sessionCursor);
    ns.setViewState(sessions.length || append ? null : 'empty');
  }

  async function selectSession(sessionId) {
    const generation = ++ns.state.detailGeneration;
    ns.state.selectedSessionId = sessionId;
    ns.state.observationCursor = null;
    ns.renderSessionSelection(sessionId);
    ns.setViewState('loading', 'Loading session detail…');
    const encoded = encodeURIComponent(sessionId);
    const results = await Promise.all([
      ns.agentFetch('/api/v1/agent/sessions/' + encoded),
      loadTimeline(false),
      ns.agentFetch('/api/v1/agent/sessions/' + encoded + '/injections'),
    ]);
    if (
      generation !== ns.state.detailGeneration ||
      ns.state.selectedSessionId !== sessionId
    ) {
      return;
    }
    ns.renderSessionDetail(results[0].session || results[0]);
    ns.renderInjections(results[2].injections || results[2].items || []);
    ns.setViewState(null);
  }

  async function loadTimeline(append) {
    const sessionId = ns.state.selectedSessionId;
    const generation = ns.state.detailGeneration;
    if (!sessionId) {
      return;
    }
    const timelineGeneration = ++ns.state.timelineGeneration;
    if (!append) {
      ns.state.observationCursor = null;
    }
    const body = await ns.agentFetch(
      '/api/v1/agent/sessions/' +
        encodeURIComponent(sessionId) +
        '/observations' +
        ns.queryString({
          cursor: append ? ns.state.observationCursor : null,
          limit: 100,
          event_type: value('as-event-type'),
          status: value('as-observation-status'),
        }),
    );
    const observations = Array.isArray(body.observations)
      ? body.observations
      : Array.isArray(body.items)
        ? body.items
        : [];
    if (
      generation !== ns.state.detailGeneration ||
      timelineGeneration !== ns.state.timelineGeneration ||
      ns.state.selectedSessionId !== sessionId
    ) {
      return;
    }
    ns.state.observationCursor = body.next_cursor || null;
    ns.renderTimeline(observations, append);
    ns.setHidden(ns.$('as-load-more-observations'), !ns.state.observationCursor);
  }

  async function loadProvenance(kind, id) {
    const body = await ns.agentFetch(
      '/api/v1/agent/provenance/detail' + ns.queryString({ [kind]: id }),
    );
    ns.renderProvenance(body);
  }

  ns.loadSessions = loadSessions;
  ns.selectSession = selectSession;
  ns.loadTimeline = loadTimeline;
  ns.loadProvenance = loadProvenance;
})(typeof window !== 'undefined' ? window : globalThis);
