/**
 * Embedding map fetch and UI status (#014, #546, Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function buildEmbeddingMapQuery(params) {
    return (
      '?provider=' +
      encodeURIComponent(params.provider) +
      '&limit=' +
      encodeURIComponent(String(params.limit)) +
      '&k=' +
      encodeURIComponent(String(params.k))
    );
  }

  function handleEmbeddingMapResponse(r) {
    st.setEmbeddingMapLoading(false);
    if (!r.ok) {
      const msg =
        (r.body && (r.body.message || r.body.error)) || `요청 실패 (${r.status})`;
      st.setEmbeddingMapError(msg, r.status === 0 || r.status >= 500);
      return;
    }
    st.lastMeta = r.body.meta || st.lastMeta;
    st.updateEmbeddingMapCacheInfo(r.body.meta);
    st.renderScatter(r.body);
  }

  st.loadEmbeddingMap = function loadEmbeddingMap(params) {
    if (!global.mementoAdminFetch) {
      st.setEmbeddingMapError(
        'mementoAdminFetch를 사용할 수 없습니다. memento-admin-fetch.js를 확인하세요.',
        true
      );
      return;
    }
    st.setEmbeddingMapError('');
    st.setEmbeddingMapLoading(true);

    global
      .mementoAdminFetch('/admin/embedding-map' + buildEmbeddingMapQuery(params))
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(handleEmbeddingMapResponse)
      .catch(function () {
        st.setEmbeddingMapLoading(false);
        st.setEmbeddingMapError('네트워크 오류로 데이터를 불러오지 못했습니다.', true);
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
