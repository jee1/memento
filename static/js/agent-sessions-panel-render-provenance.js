/**
 * Agent session dashboard provenance renderers (#460, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

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
