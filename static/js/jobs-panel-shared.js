/**
 * Jobs panel — shared URLs, DOM helpers, state (#832).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_JOBS_PANEL__ = global.__MEMENTO_JOBS_PANEL__ || {});

  ns.STATS_URL = '/admin/batch/stats';
  ns.RUN_HISTORY_URL = '/admin/batch/run-history?limit=50';

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    lastStats: null,
    lastHistory: null,
    refreshGeneration: 0,
  };

  ns.$ = function (id) {
    return document.getElementById(id);
  };

  ns.setHidden = function (element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle('hidden', hidden);
  };

  ns.clearNode = function (element) {
    if (element && typeof element.replaceChildren === 'function') {
      element.replaceChildren();
    } else if (element) {
      element.textContent = '';
    }
  };

  ns.formatIso = function (value) {
    if (!value) {
      return '—';
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  ns.formatNumber = function (value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return String(value);
  };

  ns.formatRate = function (value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return (value * 100).toFixed(2) + '%';
  };

  ns.setStatus = function (message) {
    const line = ns.$('jobs-status-line');
    if (line) {
      line.textContent = message || '';
    }
  };

  ns.setError = function (message) {
    const el = ns.$('jobs-error');
    if (!el) {
      return;
    }
    if (message) {
      el.textContent = message;
      ns.setHidden(el, false);
    } else {
      el.textContent = '';
      ns.setHidden(el, true);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
