/**
 * Embedding map chart — cluster colors (Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  st.clusterColor = function clusterColor(k, clusterIndex) {
    const t10 = d3.schemeTableau10;
    const s3 = d3.schemeSet3;
    if (k <= 10) {
      return t10[clusterIndex % t10.length];
    }
    const merged = t10.concat(s3);
    return merged[clusterIndex % merged.length];
  };
})(typeof window !== 'undefined' ? window : globalThis);
