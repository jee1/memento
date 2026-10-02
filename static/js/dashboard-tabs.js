/**
 * Dashboard Anchor / Embedding / Memory Graph / Evolution demo 탭 전환
 * CSP(script-src에 unsafe-inline 없음) 대응: 인라인 스크립트 대신 외부 파일로 로드
 *
 * WAI-ARIA Tabs - Manual activation:
 * - 좌/우/Home/End: 같은 tablist 안에서 포커스만 이동(roving tabindex); 패널은 바꾸지 않음(그래프 iframe 지연 로드 유지)
 * - Up/Down: same as Left/Right (vertical nav rail, #1144)
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

  // Compact nav (#1147): on phones the tab list sits behind a menu button and group chips jump to a group.
  const navRail = document.querySelector('.m-nav-rail');
  const navToggle = document.getElementById('dashboard-nav-toggle');

  function isCompactNav() {
    return Boolean(navToggle) && getComputedStyle(navToggle).display !== 'none' && navToggle.offsetParent !== null;
  }

  function setNavExpanded(expanded) {
    if (!navRail || !navToggle) {
      return;
    }
    navRail.classList.toggle('is-expanded', expanded);
    navToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function syncNavChips(name) {
    const btn = document.querySelector('.m-tab-btn[data-tab="' + name + '"]');
    const group = btn ? btn.closest('.m-nav-group[data-nav-group]') : null;
    const key = group ? group.getAttribute('data-nav-group') : '';
    document.querySelectorAll('.m-nav-chip[data-nav-group]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.getAttribute('data-nav-group') === key ? 'true' : 'false');
    });
  }

  function activateTab(name) {
    panels.setTabButtonsActive(name);
    panels.setPanelVisibility(name);
    tabInit.runTabInit(name);
    syncNavChips(name);
    if (isCompactNav()) {
      setNavExpanded(false);
      const activeBtn = document.querySelector('.m-tab-btn[data-tab="' + name + '"]');
      if (activeBtn) {
        setRovingTabindex(activeBtn);
      }
      navToggle.focus();
      return;
    }
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? idx + 1 : idx - 1;
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

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      setNavExpanded(navToggle.getAttribute('aria-expanded') !== 'true');
    });
  }

  if (navRail) {
    navRail.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navRail.classList.contains('is-expanded')) {
        setNavExpanded(false);
        if (navToggle) {
          navToggle.focus();
        }
      }
    });
  }

  document.querySelectorAll('.m-nav-chip[data-nav-group]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const group = document.querySelector('.m-nav-group[data-nav-group="' + chip.getAttribute('data-nav-group') + '"]');
      const first = group ? group.querySelector('.m-tab-btn[data-tab]') : null;
      if (first) {
        activateTab(first.getAttribute('data-tab'));
      }
    });
  });

  const initial = document.querySelector('.m-tab-btn[data-tab="anchor"]');
  if (initial) {
    setRovingTabindex(initial);
  }

  syncNavChips('anchor');

  global.__MEMENTO_DASHBOARD_TABS__ = {
    activateTab: activateTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
