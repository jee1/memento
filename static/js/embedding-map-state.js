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
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    tooltipEl: null,
    currentPoints: [],
    lastHealth: null,
    lastMeta: { k: 6, total: 0 },
    lastScatterPointer: null,
    requestGeneration: 0,
    problemRequestGeneration: 0,
    detailRequestGeneration: 0,
  };
})(typeof window !== 'undefined' ? window : globalThis);
