/**
 * Agent session dashboard event wiring and initialization (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

  function on(id, eventName, handler) {
    const element = ns.$(id);
    if (element) {
      element.addEventListener(eventName, handler);
    }
  }

  function wirePanel() {
    on('as-auth-form', 'submit', function (event) {
      event.preventDefault();
      const input = ns.$('as-api-key');
      ns.state.programmaticApiKey = input ? input.value : '';
      if (input) {
        input.value = '';
      }
      ns.state.loadedOnce = true;
      void ns.loadSessions(false).catch(ns.showError);
    });
    on('as-disconnect', 'click', function () {
      ns.state.programmaticApiKey = '';
      ns.state.selectedSessionId = '';
      ns.state.validatedTranscript = null;
      ns.clearNode(ns.$('as-session-list'));
      ns.clearNode(ns.$('as-timeline'));
      ns.setViewState('status', 'Programmatic API key cleared from page memory.');
    });
    on('as-refresh-sessions', 'click', function () {
      void ns.loadSessions(false).catch(ns.showError);
    });
    on('as-load-more-sessions', 'click', function () {
      void ns.loadSessions(true).catch(ns.showError);
    });
    on('as-refresh-timeline', 'click', function () {
      void ns.loadTimeline(false).catch(ns.showError);
    });
    on('as-load-more-observations', 'click', function () {
      void ns.loadTimeline(true).catch(ns.showError);
    });
    on('as-provenance-form', 'submit', function (event) {
      event.preventDefault();
      const kind = ns.$('as-provenance-kind');
      const id = ns.$('as-provenance-id');
      if (kind && id && id.value.trim()) {
        void ns.loadProvenance(kind.value, id.value.trim()).catch(ns.showError);
      }
    });
    on('as-transcript-jsonl', 'input', ns.invalidateTranscriptDryRun);
    on('as-transcript-file', 'change', function (event) {
      const files = event.target.files;
      ns.readTranscriptFile(files && files[0]);
    });
    on('as-transcript-dry-run', 'click', function () {
      void ns.submitTranscript(true).catch(ns.showError);
    });
    on('as-transcript-import', 'click', function () {
      void ns.submitTranscript(false).catch(ns.showError);
    });
  }

  function initAgentSessionsPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
    if (!ns.state.programmaticApiKey) {
      ns.setViewState(
        'status',
        'Enter a programmatic API key. It remains only in page memory and is cleared on reload.',
      );
      const input = ns.$('as-api-key');
      if (input) {
        input.focus();
      }
      return;
    }
    void ns.loadSessions(false).catch(ns.showError);
  }

  global.initAgentSessionsPanel = initAgentSessionsPanel;
})(typeof window !== 'undefined' ? window : globalThis);
