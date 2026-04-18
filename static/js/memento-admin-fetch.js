/**
 * Dashboard/admin fetch helper.
 * Browser admin flows rely on same-origin cookies issued by /auth/session.
 */
(function (global) {
  'use strict';

  function getDashboardAuth() {
    return global.__MEMENTO_DASHBOARD_AUTH__ || null;
  }

  function waitForSession() {
    var dashboardAuth = getDashboardAuth();
    if (dashboardAuth && typeof dashboardAuth.waitForSession === 'function') {
      return dashboardAuth.waitForSession();
    }
    return Promise.resolve();
  }

  function buildRequestOptions(opts) {
    var merged = Object.assign({}, opts || {});
    if (!merged.credentials) {
      merged.credentials = 'same-origin';
    }
    return merged;
  }

  function performFetch(url, opts, retriedAfterAuthReset) {
    return fetch(url, opts).then(function (response) {
      var dashboardAuth = getDashboardAuth();
      if (
        response.status === 401 &&
        !retriedAfterAuthReset &&
        dashboardAuth &&
        typeof dashboardAuth.handleUnauthorized === 'function'
      ) {
        dashboardAuth.handleUnauthorized();
        return dashboardAuth.waitForSession().then(function () {
          return performFetch(url, buildRequestOptions(opts), true);
        });
      }
      return response;
    });
  }

  /**
   * @param {string|URL} url
   * @param {RequestInit} [opts]
   * @returns {Promise<Response>}
   */
  function mementoAdminFetch(url, opts) {
    var requestOptions = buildRequestOptions(opts);
    return waitForSession().then(function () {
      return performFetch(url, requestOptions, false);
    });
  }

  global.mementoAdminFetch = mementoAdminFetch;
})(typeof window !== 'undefined' ? window : globalThis);
