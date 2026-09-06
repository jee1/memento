/**
 * Agent session dashboard shared state and safe DOM helpers (#460).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_AGENT_SESSIONS_PANEL__ =
    global.__MEMENTO_AGENT_SESSIONS_PANEL__ || {});

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    programmaticApiKey: '',
    selectedSessionId: '',
    sessionCursor: null,
    observationCursor: null,
    validatedTranscript: null,
    loadGeneration: 0,
    detailGeneration: 0,
    timelineGeneration: 0,
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
      element.replaceChildren();
    }
  };

  ns.appendText = function (parent, tag, text, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text == null ? '' : String(text);
    parent.appendChild(element);
    return element;
  };

  ns.formatTime = function (value) {
    if (!value) {
      return 'Unknown time';
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  ns.setViewState = function (name, message) {
    ['loading', 'empty', 'error', 'status'].forEach(function (stateName) {
      const element = ns.$('as-' + stateName);
      const active = stateName === name;
      ns.setHidden(element, !active);
      if (active && message) {
        element.textContent = message;
      }
    });
  };

  ns.agentFetch = async function (path, options) {
    const state = ns.state;
    if (!state.programmaticApiKey) {
      throw new Error('Enter a programmatic API key for Agent Sessions.');
    }
    const request = Object.assign({}, options || {});
    request.headers = Object.assign({}, request.headers || {}, {
      Authorization: 'Bearer ' + state.programmaticApiKey,
      Accept: 'application/json',
    });
    const response = await global.fetch(path, request);
    const body = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      const safeMessage =
        body && typeof body.message === 'string'
          ? body.message
          : 'Agent API request failed (' + response.status + ').';
      throw new Error(safeMessage);
    }
    return body;
  };

  ns.queryString = function (params) {
    const query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
    const value = query.toString();
    return value ? '?' + value : '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
