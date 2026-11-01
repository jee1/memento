/**
 * Settings panel — shared URLs, strings, state, DOM and request helpers.
 * Server strings (values, reasons, actors) reach the page through textContent only.
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_SETTINGS_PANEL__ = global.__MEMENTO_SETTINGS_PANEL__ || {});

  ns.SETTINGS_URL = '/admin/settings';
  ns.EVENTS_URL = '/admin/settings/events';

  // Korean UI strings. Code references ns.S.* only; edit text here, not in the logic.
  ns.S = {
    sourceLabel: { override: 'DB', env: '.env', default: '기본값' },
    riskLabel: { low: '위험 낮음', medium: '위험 중간', high: '위험 높음' },
    applyImmediate: '즉시 반영',
    applyRestart: '재기동 필요',
    pendingRestart: '재기동 대기',
    overrideIgnored: '저장됐지만 적용 안 됨',
    drift: '기본값과 다름',
    unset: '미설정',
    secretSet: '설정됨(값 가림)',
    emptyValue: '(비어 있음)',
    none: '—',
    rangePrefix: '범위 ',
    change: '변경',
    revert: '되돌리기',
    choose: '선택',
    sameValue: '현재 값과 같습니다.',
    actionLabel: { set: '변경', revert: '되돌림' },
    allKeys: '전체',
    reasonRequired: '사유를 입력하세요.',
    loadFailed: '설정을 불러오지 못했습니다.',
    dialogTitleSet: function (key) {
      return key + ' 변경';
    },
    dialogTitleRevert: function (key) {
      return key + ' 되돌리기';
    },
    dialogSummary: function (from, to) {
      return from + ' → ' + to;
    },
    noteStrong: '운영 동작에 직접 영향을 주는 설정입니다. 값과 사유를 다시 확인하세요.',
    noteRestart: '재기동 후 반영됩니다. 지금 실행 중인 프로세스에는 적용되지 않습니다.',
    noteRevert: '되돌리면 DB 값을 지우고 .env 또는 기본값으로 돌아갑니다.',
    sameValuePin:
      '현재 값과 같습니다. 화면 값과 같게 저장해도 DB override 는 만들지 않습니다(.env·기본값을 DB 에 고정하는 pin 은 지원하지 않음).',
    changedBy: function (actor, when) {
      return actor + ' (' + when + ')';
    },
    failure: function (data, status) {
      const code = data && data.code ? data.code : 'HTTP_' + status;
      const message = data && data.error ? data.error : '';
      return message ? code + ': ' + message : code;
    },
  };

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    settings: [],
    readOnly: [],
    eventsKey: '',
    dialog: null,
    inFlight: false,
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
    ns.setHidden(ns.$('settings-loading'), !loading);
  };

  ns.setError = function (message) {
    const el = ns.$('settings-error');
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
      return ns.S.none;
    }
    const date = new Date(String(iso));
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
  };

  /** null means "not set" in the API; an empty string is shown as such, not as unset. */
  ns.formatValue = function (value) {
    if (value === null || value === undefined) {
      return ns.S.unset;
    }
    return value === '' ? ns.S.emptyValue : String(value);
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
