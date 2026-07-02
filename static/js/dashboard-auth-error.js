/**
 * Dashboard session auth response message helpers.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.readAuthErrorMessage = function (response, fallbackMessage) {
    return response
      .json()
      .then(function (payload) {
        if (payload && typeof payload.message === 'string' && payload.message.trim() !== '') {
          return payload.message.trim();
        }
        return fallbackMessage;
      })
      .catch(function () {
        return fallbackMessage;
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
