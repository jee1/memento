/**
 * Dashboard Anchor / Embedding / Memory Graph / Evolution demo 탭 전환
 * CSP(script-src에 unsafe-inline 없음) 대응: 인라인 스크립트 대신 외부 파일로 로드
 *
 * WAI-ARIA Tabs — Manual activation:
 * - 좌/우/Home/End: 같은 tablist 안에서 포커스만 이동(roving tabindex); 패널은 바꾸지 않음(그래프 iframe 지연 로드 유지)
 * - Enter/Space 또는 클릭: 해당 탭 활성화
 */
(function (global) {
  'use strict';

  const GRAPH_IFRAME_SRC = '/graph';

  function getTabButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('.m-tab-bar .m-tab-btn'));
  }

  function dispatchGraphIframeResize(iframe) {
    if (!iframe || !iframe.contentWindow) {
      return;
    }
    iframe.contentWindow.dispatchEvent(new Event('resize'));
  }

  function setRovingTabindex(focusedBtn) {
    getTabButtons().forEach(function (b) {
      b.setAttribute('tabindex', b === focusedBtn ? '0' : '-1');
    });
  }

  function activateTab(name) {
    const evolutionPanel = document.getElementById('tab-evolution-demo');
    const anchorPanel = document.getElementById('tab-anchor-map');
    const embedPanel = document.getElementById('tab-embedding-map');
    const graphPanel = document.getElementById('tab-graph');
    const reviewPanel = document.getElementById('tab-review-candidates');
    const buttons = document.querySelectorAll('.m-tab-btn');
    buttons.forEach(function (b) {
      const on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (evolutionPanel) {
      evolutionPanel.classList.toggle('active', name === 'evolution-demo');
      evolutionPanel.setAttribute('aria-hidden', name === 'evolution-demo' ? 'false' : 'true');
    }
    if (anchorPanel) {
      anchorPanel.classList.toggle('active', name === 'anchor');
      anchorPanel.setAttribute('aria-hidden', name === 'anchor' ? 'false' : 'true');
    }
    if (embedPanel) {
      embedPanel.classList.toggle('active', name === 'embedding');
      embedPanel.setAttribute('aria-hidden', name === 'embedding' ? 'false' : 'true');
    }
    if (graphPanel) {
      graphPanel.classList.toggle('active', name === 'graph');
      graphPanel.setAttribute('aria-hidden', name === 'graph' ? 'false' : 'true');
    }
    if (reviewPanel) {
      reviewPanel.classList.toggle('active', name === 'review');
      reviewPanel.setAttribute('aria-hidden', name === 'review' ? 'false' : 'true');
    }
    if (name === 'evolution-demo') {
      const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
      if (shell && typeof shell.init === 'function') {
        shell.init();
      }
      requestAnimationFrame(function () {
        global.dispatchEvent(new Event('resize'));
      });
    }
    if (name === 'embedding' && typeof global.initEmbeddingMap === 'function') {
      global.initEmbeddingMap();
    }
    if (name === 'review' && typeof global.initReviewCandidatesPanel === 'function') {
      global.initReviewCandidatesPanel();
    }
    if (name === 'graph') {
      const iframe = document.getElementById('graph-view-iframe');
      if (iframe && !iframe.hasAttribute('data-loaded')) {
        iframe.setAttribute('data-loaded', '');
        iframe.addEventListener('load', function onGraphFrameLoad() {
          iframe.removeEventListener('load', onGraphFrameLoad);
          requestAnimationFrame(function () {
            global.dispatchEvent(new Event('resize'));
            dispatchGraphIframeResize(iframe);
          });
        });
        iframe.src = GRAPH_IFRAME_SRC;
      } else if (iframe) {
        requestAnimationFrame(function () {
          global.dispatchEvent(new Event('resize'));
          dispatchGraphIframeResize(iframe);
        });
      }
    } else if (name === 'anchor' || name === 'embedding' || name === 'review') {
      requestAnimationFrame(function () {
        global.dispatchEvent(new Event('resize'));
      });
    }

    const activeBtn = document.querySelector('.m-tab-btn[data-tab="' + name + '"]');
    if (activeBtn) {
      setRovingTabindex(activeBtn);
      activeBtn.focus();
    }
  }

  const tabBar = document.querySelector('.m-tab-bar');
  if (tabBar) {
    tabBar.addEventListener('keydown', function (e) {
      const target = e.target;
      if (!target || !target.classList || !target.classList.contains('m-tab-btn')) {
        return;
      }
      const buttons = getTabButtons();
      const idx = buttons.indexOf(target);
      if (idx < 0) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        let next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        if (next < 0) {
          next = buttons.length - 1;
        }
        if (next >= buttons.length) {
          next = 0;
        }
        const nextBtn = buttons[next];
        setRovingTabindex(nextBtn);
        nextBtn.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        const first = buttons[0];
        setRovingTabindex(first);
        first.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const lastBtn = buttons[buttons.length - 1];
        setRovingTabindex(lastBtn);
        lastBtn.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const tabName = target.getAttribute('data-tab');
        if (tabName) {
          activateTab(tabName);
        }
      }
    });
  }

  document.querySelectorAll('.m-tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const tab = btn.getAttribute('data-tab');
      if (tab) {
        activateTab(tab);
      }
    });
  });

  const initial = document.querySelector('.m-tab-btn[data-tab="evolution-demo"]');
  if (initial) {
    setRovingTabindex(initial);
  }

  global.__MEMENTO_DASHBOARD_TABS__ = {
    activateTab: activateTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
