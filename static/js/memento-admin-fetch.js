/**
 * Admin/API 라우트용 fetch — 서버가 내려주는 window.__MEMENTO_ADMIN_FETCH_CONFIG__.apiKey
 * 또는 sessionStorage.memento_admin_api_key 를 Authorization: Bearer 로 붙입니다.
 * (009-memory-graph-view / Anchor Map 대시보드)
 */
(function (global) {
  'use strict';

  function getApiKey() {
    try {
      var fromSession = global.sessionStorage && global.sessionStorage.getItem('memento_admin_api_key');
      if (fromSession) {
        return fromSession;
      }
    } catch (_e) {
      /* private mode 등 */
    }
    var cfg = global.__MEMENTO_ADMIN_FETCH_CONFIG__;
    if (cfg && cfg.apiKey != null && String(cfg.apiKey).length > 0) {
      return String(cfg.apiKey);
    }
    return '';
  }

  /** Authorization / X-API-Value는 ByteString — 비ASCII면 Headers.set이 예외를 던질 수 있음 */
  function isAsciiOnly(s) {
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 127) {
        return false;
      }
    }
    return true;
  }

  function mergeHeaders(extra) {
    var h = new Headers(extra || {});
    var key = getApiKey();
    if (key) {
      if (!isAsciiOnly(key)) {
        console.warn(
          '[Memento] ADMIN_API_KEY에 ASCII가 아닌 문자가 포함되어 있어 브라우저가 Authorization 헤더를 보낼 수 없습니다. 영숫자·`-_` 등 ASCII만 사용한 키로 바꾸세요.'
        );
      } else {
        try {
          h.set('Authorization', 'Bearer ' + key);
        } catch (e) {
          console.warn('[Memento] Authorization 헤더 설정 실패:', e);
        }
      }
    }
    return h;
  }

  /**
   * @param {string|URL} url
   * @param {RequestInit} [opts]
   * @returns {Promise<Response>}
   */
  function mementoAdminFetch(url, opts) {
    opts = opts || {};
    var merged = Object.assign({}, opts);
    merged.headers = mergeHeaders(opts.headers);
    if (!merged.credentials) {
      merged.credentials = 'same-origin';
    }
    return fetch(url, merged);
  }

  global.mementoAdminFetch = mementoAdminFetch;
})(typeof window !== 'undefined' ? window : globalThis);
