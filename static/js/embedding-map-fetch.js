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

  function handleEmbeddingMapResponse(r, generation) {
    if (generation !== st.requestGeneration) return;
    st.setEmbeddingMapLoading(false);
    if (!r.ok) {
      const msg =
        (r.body && (r.body.message || r.body.error)) || `요청 실패 (${r.status})`;
      st.setEmbeddingMapError(msg, r.status === 0 || r.status >= 500);
      return;
    }
    st.lastMeta = r.body.meta || st.lastMeta;
    st.updateEmbeddingMapCacheInfo(r.body.meta);
    st.renderEmbeddingMapMeta(r.body);
    st.renderScatter(r.body);
  }

  function loadEmbeddingHealth(params, generation) {
    global
      .mementoAdminFetch(
        '/admin/embedding-health?provider=' + encodeURIComponent(params.provider)
      )
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (generation !== st.requestGeneration) return;
        if (!r.ok) {
          st.renderEmbeddingHealthError(
            (r.body && (r.body.message || r.body.error)) || `요청 실패 (${r.status})`
          );
          return;
        }
        st.lastHealth = r.body.diagnostics;
        st.renderEmbeddingHealth(r.body.diagnostics);
        if (st.lastMeta && st.lastMeta.provider === r.body.diagnostics.provider) {
          st.renderEmbeddingMapMeta({ points: st.currentPoints, meta: st.lastMeta });
        }
      })
      .catch(function () {
        if (generation !== st.requestGeneration) return;
        st.renderEmbeddingHealthError('임베딩 진단을 불러오지 못했습니다.');
      });
  }

  st.loadEmbeddingProblems = function loadEmbeddingProblems(problem, provider, offset) {
    const generation = ++st.problemRequestGeneration;
    global
      .mementoAdminFetch(
        '/admin/embedding-health?provider=' +
          encodeURIComponent(provider) +
          '&problem=' +
          encodeURIComponent(problem) +
          '&limit=50&offset=' +
          encodeURIComponent(String(offset || 0))
      )
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (generation !== st.problemRequestGeneration) return;
        if (!r.ok) {
          st.renderEmbeddingHealthError(
            (r.body && (r.body.message || r.body.error)) || `요청 실패 (${r.status})`
          );
          return;
        }
        st.renderEmbeddingProblemList(r.body);
      })
      .catch(function () {
        if (generation !== st.problemRequestGeneration) return;
        st.renderEmbeddingHealthError('문제 기억 목록을 불러오지 못했습니다.');
      });
  };

  st.loadEmbeddingMap = function loadEmbeddingMap(params) {
    if (!global.mementoAdminFetch) {
      st.setEmbeddingMapError(
        'mementoAdminFetch를 사용할 수 없습니다. memento-admin-fetch.js를 확인하세요.',
        true
      );
      return;
    }
    const generation = ++st.requestGeneration;
    st.problemRequestGeneration++;
    st.detailRequestGeneration++;
    st.lastHealth = null;
    st.lastMeta = null;
    st.currentPoints = [];
    if (st.plotG) st.plotG.selectAll('circle.em-dot').remove();
    ['em-health-summary', 'em-health-problems', 'em-problem-list', 'em-sample-info', 'em-cluster-summary']
      .forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.replaceChildren();
      });
    st.setEmbeddingMapError('');
    st.setEmbeddingMapLoading(true);
    loadEmbeddingHealth(params, generation);

    global
      .mementoAdminFetch('/admin/embedding-map' + buildEmbeddingMapQuery(params))
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) { handleEmbeddingMapResponse(r, generation); })
      .catch(function () {
        if (generation !== st.requestGeneration) return;
        st.setEmbeddingMapLoading(false);
        st.setEmbeddingMapError('네트워크 오류로 데이터를 불러오지 못했습니다.', true);
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
