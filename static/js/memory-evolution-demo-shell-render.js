/**
 * Memory evolution demo - render registrar (#445, #450).
 * Companions: render-timeline, render-consolidation, render-snapshot (load before data.js).
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;
  const required = [
    'renderPointSegment',
    'renderConsolidationPanel',
    'renderSnapshot',
    'updateComparisonHint',
    'syncSegmentSelection',
  ];
  for (let i = 0; i < required.length; i += 1) {
    if (typeof ns[required[i]] !== 'function') {
      throw new Error('memory-evolution-demo-shell-render: missing ' + required[i]);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
