/**
 * Agent session dashboard render registrar (#460, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }
  const required = [
    'renderAggregate',
    'renderSessions',
    'renderSessionSelection',
    'renderSessionDetail',
    'renderTimeline',
    'renderInjections',
    'renderProvenance',
    'showError',
  ];
  for (let i = 0; i < required.length; i += 1) {
    if (typeof ns[required[i]] !== 'function') {
      throw new Error('agent-sessions-panel-render: missing ' + required[i]);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
