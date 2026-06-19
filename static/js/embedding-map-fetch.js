/**
 * Embedding map fetch and UI status (#014, #546).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function readParams() {
    const prov = document.getElementById('em-provider');
    const lim = document.getElementById('em-limit');
    const kEl = document.getElementById('em-k');
    return {
      provider: prov ? prov.value : 'minilm',
      limit: lim ? parseInt(lim.value, 10) || 300 : 300,
      k: kEl ? parseInt(kEl.value, 10) || 6 : 6,
    };
  }

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
        st.loadEmbeddingMap(readParams());
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
      el.textContent = min + '분 전 캐시';
    } else {
      el.textContent = '';
    }
  }

  function loadEmbeddingMap(params) {
    if (!global.mementoAdminFetch) {
      setError('mementoAdminFetch를 사용할 수 없습니다. memento-admin-fetch.js를 확인하세요.', true);
      return;
    }
    setError('');
    setLoading(true);
    const q =
      '?provider=' +
      encodeURIComponent(params.provider) +
      '&limit=' +
      encodeURIComponent(String(params.limit)) +
      '&k=' +
      encodeURIComponent(String(params.k));

    global
      .mementoAdminFetch('/admin/embedding-map' + q)
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        setLoading(false);
        if (!r.ok) {
          const msg =
            (r.body && (r.body.message || r.body.error)) ||
            '요청 실패 (' + r.status + ')';
          setError(msg, r.status === 0 || r.status >= 500);
          return;
        }
        st.lastMeta = r.body.meta || st.lastMeta;
        updateCacheInfo(r.body.meta);
        st.renderScatter(r.body);
      })
      .catch(function () {
        setLoading(false);
        setError('네트워크 오류로 데이터를 불러오지 못했습니다.', true);
      });
  }

  st.readParams = readParams;
  st.loadEmbeddingMap = loadEmbeddingMap;
})(typeof window !== 'undefined' ? window : globalThis);
