/**
 * Embedding Map init/wiring - UMAP 2D scatter (014-embedding-map-dashboard)
 * D3 v7 + mementoAdminFetch
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function refreshChartIfActive() {
    const tab = document.getElementById('tab-embedding-map');
    if (!tab || !tab.classList.contains('active')) {
      return;
    }
    st.setupChart();
    if (st.currentPoints.length) {
      st.renderScatter({ points: st.currentPoints, meta: st.lastMeta });
    }
  }

  function initEmbeddingMap() {
    if (!st.didSetup) {
      st.didSetup = true;
      st.setupChart();
      const loadBtn = document.getElementById('em-load-btn');
      if (loadBtn) {
        loadBtn.addEventListener('click', function () {
          st.loadEmbeddingMap(st.readParams());
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          st.closeSidePanel();
        }
      });
      window.addEventListener('resize', refreshChartIfActive);
    } else {
      st.setupChart();
      if (st.currentPoints.length) {
        st.renderScatter({ points: st.currentPoints, meta: st.lastMeta });
      }
    }

    if (!st.firstAutoLoadDone) {
      st.firstAutoLoadDone = true;
      st.loadEmbeddingMap(st.readParams());
    }
  }

  global.initEmbeddingMap = initEmbeddingMap;
})(typeof window !== 'undefined' ? window : globalThis);
