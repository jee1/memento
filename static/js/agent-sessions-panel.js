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
      ns.setViewState('status', '페이지 메모리에서 Programmatic API 키를 지웠습니다.');
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
    ns.DETAIL_TABS.forEach(function (t) {
      on('as-dtab-' + t, 'click', function () {
        ns.showDetailTab(t);
      });
      on('as-dtab-' + t, 'keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return;
        }
        event.preventDefault();
        const idx = ns.DETAIL_TABS.indexOf(t);
        const next =
          event.key === 'ArrowRight'
            ? ns.DETAIL_TABS[(idx + 1) % ns.DETAIL_TABS.length]
            : ns.DETAIL_TABS[(idx - 1 + ns.DETAIL_TABS.length) % ns.DETAIL_TABS.length];
        ns.showDetailTab(next);
        const tab = ns.$('as-dtab-' + next);
        if (tab) {
          tab.focus();
        }
      });
    });
    ns.showDetailTab('overview');
  }

  function initAgentSessionsPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
    if (!ns.state.programmaticApiKey) {
      ns.setViewState(
        'status',
        'Programmatic API 키를 입력하세요. 페이지 메모리에만 보관되며 새로고침 시 지워집니다.',
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
