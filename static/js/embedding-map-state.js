/**
 * Embedding map shared chart state (#014, #546).
 */
(function (global) {
  'use strict';

  global.__MEMENTO_EMBEDDING_MAP__ = {
    didSetup: false,
    firstAutoLoadDone: false,
    svg: null,
    zoomG: null,
    plotG: null,
    xScale: null,
    yScale: null,
    width: 0,
    height: 0,
    margin: { top: 24, right: 24, bottom: 40, left: 48 },
    tooltipEl: null,
    currentPoints: [],
    lastMeta: { k: 6, total: 0 },
    lastScatterPointer: null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
