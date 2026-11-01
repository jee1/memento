/**
 * Ranking weights panel — shared URLs, strings, state, DOM and request helpers.
 * Server strings (reasons, actors, commands, reject messages) reach the page through textContent only.
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_RANKING_PANEL__ = global.__MEMENTO_RANKING_PANEL__ || {});

  ns.WEIGHTS_URL = '/admin/ranking/weights';
  ns.PROPOSALS_URL = '/admin/ranking/proposals';

  // Korean UI strings. Code references ns.S.* only; edit text here, not in the logic.
  ns.S = {
    unset: '—',
    drift: '파일과 다름',
    rangePrefix: '범위 ',
    sourcePath: function (path) {
      return '서버가 읽는 파일: ' + path;
    },
    loadFailed: '랭킹 가중치를 불러오지 못했습니다.',
    noChange: '바꾼 값이 없습니다. 제안 값을 파일 값과 다르게 입력하세요.',
    invalidNumber: function (key) {
      return key + ' 는 숫자여야 합니다.';
    },
    reasonRequired: '사유를 입력하세요.',
    changeLine: function (key, from, to) {
      return key + ': ' + from + ' → ' + to;
    },
    proposalHeading: function (id) {
      return '제안 ' + id.slice(0, 8);
    },
    previewScope: function (count, version) {
      return 'dev 쿼리 ' + count + '개 (' + version + '). held-out 쿼리는 쓰지 않습니다.';
    },
    metricLabel: {
      ndcg_at_10: 'NDCG@10',
      mrr: 'MRR',
      recall_at_10: 'Recall@10',
      empty_result_rate: '빈 결과 비율',
      p95_latency_ms: 'p95 지연(ms)',
      relevance_tie_rate: 'relevance 동점 비율',
    },
    tiePassed: 'relevance 동점 게이트 통과',
    tieFailed: 'relevance 동점 게이트 실패',
    copied: '복사했습니다.',
    copyFailed: '복사하지 못했습니다. 명령을 직접 선택해 복사하세요.',
    hasPreview: '있음',
    noPreview: '없음',
    open: '열기',
    failure: function (data, status) {
      const code = data && data.code ? data.code : 'HTTP_' + status;
      const message = data && data.error ? data.error : '';
      return message ? code + ': ' + message : code;
    },
  };

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    knobs: [],
    inputs: {},
    previewEnabled: false,
    sourcePath: null,
    proposals: [],
    current: null,
    dialog: null,
    inFlight: false,
    previewing: false,
    refreshGeneration: 0,
  };

  ns.$ = function (id) {
    return document.getElementById(id);
  };

  ns.setHidden = function (element, hidden) {
    if (element) {
      element.classList.toggle('hidden', hidden);
    }
  };

  ns.clearNode = function (element) {
    if (element) {
      element.textContent = '';
    }
  };

  ns.setLoading = function (loading) {
    ns.setHidden(ns.$('ranking-loading'), !loading);
  };

  ns.setError = function (message) {
    const el = ns.$('ranking-error');
    if (el) {
      el.textContent = message || '';
      ns.setHidden(el, !message);
    }
  };

  /** Build an element with optional class and text. */
  ns.el = function (tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  };

  ns.formatTime = function (iso) {
    if (!iso) {
      return ns.S.unset;
    }
    const date = new Date(String(iso));
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
  };

  ns.formatNumber = function (value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : ns.S.unset;
  };

  /** Resolves to { ok, status, data } and never rejects on an HTTP error. */
  ns.request = function (method, url, body) {
    const doFetch = global.mementoAdminFetch || global.fetch;
    const options = { method: method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    return doFetch(url, options).then(function (response) {
      return response.json().then(
        function (data) {
          return { ok: response.ok, status: response.status, data: data };
        },
        function () {
          return { ok: response.ok, status: response.status, data: null };
        },
      );
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
