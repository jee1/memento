/**
 * Dashboard Anchor / Embedding / Memory Graph / Evolution demo 탭 전환
 * CSP(script-src에 unsafe-inline 없음) 대응: 인라인 스크립트 대신 외부 파일로 로드
 *
 * WAI-ARIA Tabs - Manual activation:
 * - 좌/우/Home/End: 같은 tablist 안에서 포커스만 이동(roving tabindex); 패널은 바꾸지 않음(그래프 iframe 지연 로드 유지)
 * - Enter/Space 또는 클릭: 해당 탭 활성화
 */
(function (global) {
  'use strict';

  const panels = global.__MEMENTO_DASHBOARD_TAB_PANELS__;
  const tabInit = global.__MEMENTO_DASHBOARD_TAB_INIT__;
  if (!panels || !tabInit) {
    return;
  }

  function getTabButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('.m-tab-bar .m-tab-btn'));
  }

  function setRovingTabindex(focusedBtn) {
    getTabButtons().forEach(function (b) {
      b.setAttribute('tabindex', b === focusedBtn ? '0' : '-1');
    });
  }

  function focusActiveTabButton(name) {
    const activeBtn = document.querySelector('.m-tab-btn[data-tab="' + name + '"]');
    if (!activeBtn) {
      return;
    }
    setRovingTabindex(activeBtn);
    activeBtn.focus();
  }

  function activateTab(name) {
    panels.setTabButtonsActive(name);
    panels.setPanelVisibility(name);
    tabInit.runTabInit(name);
    focusActiveTabButton(name);
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

  const initial = document.querySelector('.m-tab-btn[data-tab="anchor"]');
  if (initial) {
    setRovingTabindex(initial);
  }

  global.__MEMENTO_DASHBOARD_TABS__ = {
    activateTab: activateTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
