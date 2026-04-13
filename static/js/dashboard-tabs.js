/**
 * Dashboard Anchor / Embedding 탭 전환
 * CSP(script-src에 unsafe-inline 없음) 대응: 인라인 스크립트 대신 외부 파일로 로드
 */
(function () {
  'use strict';

  function activateTab(name) {
    var anchorPanel = document.getElementById('tab-anchor-map');
    var embedPanel = document.getElementById('tab-embedding-map');
    var buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (anchorPanel) {
      anchorPanel.classList.toggle('active', name === 'anchor');
    }
    if (embedPanel) {
      embedPanel.classList.toggle('active', name === 'embedding');
    }
    if (name === 'embedding' && typeof window.initEmbeddingMap === 'function') {
      window.initEmbeddingMap();
    }
    if (name === 'anchor') {
      requestAnimationFrame(function () {
        window.dispatchEvent(new Event('resize'));
      });
    }
  }

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      if (tab) {
        activateTab(tab);
      }
    });
  });
})();
