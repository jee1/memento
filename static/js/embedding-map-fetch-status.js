/**
 * Embedding map fetch — status and params (Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  st.readParams = function readParams() {
    const prov = document.getElementById('em-provider');
    const lim = document.getElementById('em-limit');
    const kEl = document.getElementById('em-k');
    return {
      provider: prov ? prov.value : 'minilm',
      limit: lim ? parseInt(lim.value, 10) || 300 : 300,
      k: kEl ? parseInt(kEl.value, 10) || 6 : 6,
    };
  };

  function setLoading(on) {
    const el = document.getElementById('em-loading');
    if (el) {
      el.classList.toggle('hidden', !on);
    }
  }

  function setError(msg, showRetry) {
    const el = document.getElementById('em-error');
    if (!el) {
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    if (!msg) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const p = document.createElement('p');
    p.textContent = msg;
    el.appendChild(p);
    if (showRetry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'em-retry-btn';
      retry.textContent = 'Retry';
      retry.addEventListener('click', function () {
        st.loadEmbeddingMap(st.readParams());
      });
      el.appendChild(retry);
    }
  }

  function updateCacheInfo(meta) {
    const el = document.getElementById('em-cache-info');
    if (!el || !meta) {
      return;
    }
    if (meta.cached && meta.computed_at) {
      const ms = Date.now() - new Date(meta.computed_at).getTime();
      const min = Math.max(0, Math.round(ms / 60000));
      el.textContent = `${min}분 전 캐시`;
    } else {
      el.textContent = '';
    }
  }

  st.setEmbeddingMapLoading = setLoading;
  st.setEmbeddingMapError = setError;
  st.updateEmbeddingMapCacheInfo = updateCacheInfo;
})(typeof window !== 'undefined' ? window : globalThis);
