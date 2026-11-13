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

  function initJobsTab() {
    if (typeof global.initJobsPanel === 'function') {
      global.initJobsPanel();
    }
    dispatchDashboardResize();
  }

  function initMemoryFinderTab() {
    if (typeof global.initMemoryFinderPanel === 'function') {
      global.initMemoryFinderPanel();
    }
    dispatchDashboardResize();
  }

  function initSupersedeTab() {
    if (typeof global.initSupersedeCandidatesPanel === 'function') {
      global.initSupersedeCandidatesPanel();
    }
    dispatchDashboardResize();
  }

  function initSettingsTab() {
    if (typeof global.initSettingsPanel === 'function') {
      global.initSettingsPanel();
    }
    dispatchDashboardResize();
  }

  function initOpsOverviewTab() {
    if (typeof global.initOpsOverviewPanel === 'function') {
      global.initOpsOverviewPanel();
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
    if (name === 'embedding') {
      initEmbeddingTab();
      return;
    }
    if (name === 'review') {
      initReviewTab();
      return;
    }
    if (name === 'supersede') {
      initSupersedeTab();
      return;
    }
    if (name === 'memory-finder') {
      initMemoryFinderTab();
      return;
    }
    if (name === 'jobs') {
      initJobsTab();
      return;
    }
    if (name === 'settings') {
      initSettingsTab();
      return;
    }
    if (name === 'ops-overview') {
      initOpsOverviewTab();
      return;
    }
    if (name === 'ops-status') {
      if (typeof global.initOpsStatusPanel === 'function') {
        global.initOpsStatusPanel();
      }
      dispatchDashboardResize();
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
