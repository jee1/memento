/**
 * Agent session dashboard timeline category helpers (#460, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

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

  ns.eventCategory = eventCategory;
})(typeof window !== 'undefined' ? window : globalThis);
