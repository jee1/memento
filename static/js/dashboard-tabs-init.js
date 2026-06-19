/**
 * Dashboard tab-specific init handlers (iframe, panel refresh).
 */
(function (global) {
  'use strict';

  const GRAPH_IFRAME_SRC = '/graph?embed=dashboard';

  function dispatchGraphIframeResize(iframe) {
    if (!iframe || !iframe.contentWindow) {
      return;
    }
    iframe.contentWindow.dispatchEvent(new Event('resize'));
  }

  function dispatchDashboardResize() {
    requestAnimationFrame(function () {
      global.dispatchEvent(new Event('resize'));
    });
  }

  function initEvolutionDemo() {
    const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
    if (!shell) {
      return;
    }
    if (typeof shell.initPanel === 'function') {
      shell.initPanel();
    } else if (typeof shell.refresh === 'function') {
      shell.refresh();
    } else if (typeof shell.init === 'function') {
      shell.init();
    }
    dispatchDashboardResize();
  }

  function initEmbeddingTab() {
    if (typeof global.initEmbeddingMap === 'function') {
      global.initEmbeddingMap();
    }
    dispatchDashboardResize();
  }

  function initReviewTab() {
    if (typeof global.initReviewCandidatesPanel === 'function') {
      global.initReviewCandidatesPanel();
    }
    dispatchDashboardResize();
  }

  function initAgentSessionsTab() {
    if (typeof global.initAgentSessionsPanel === 'function') {
      global.initAgentSessionsPanel();
    }
    dispatchDashboardResize();
  }

  function initGraphTab() {
    const iframe = document.getElementById('graph-view-iframe');
    if (!iframe) {
      return;
    }
    if (!iframe.hasAttribute('data-loaded')) {
      iframe.setAttribute('data-loaded', '');
      iframe.addEventListener('load', function onGraphFrameLoad() {
        iframe.removeEventListener('load', onGraphFrameLoad);
        dispatchDashboardResize();
        dispatchGraphIframeResize(iframe);
      });
      iframe.src = GRAPH_IFRAME_SRC;
      return;
    }
    dispatchDashboardResize();
    dispatchGraphIframeResize(iframe);
  }

  function runTabInit(name) {
    if (name === 'evolution-demo') {
      initEvolutionDemo();
      return;
    }
    if (name === 'embedding') {
      initEmbeddingTab();
      return;
    }
    if (name === 'review') {
      initReviewTab();
      return;
    }
    if (name === 'agent-sessions') {
      initAgentSessionsTab();
      return;
    }
    if (name === 'graph') {
      initGraphTab();
      return;
    }
    if (name === 'anchor') {
      dispatchDashboardResize();
    }
  }

  global.__MEMENTO_DASHBOARD_TAB_INIT__ = {
    GRAPH_IFRAME_SRC: GRAPH_IFRAME_SRC,
    runTabInit: runTabInit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
