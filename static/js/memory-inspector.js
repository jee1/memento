/**
 * Memory inspector (#1025) — the 기억 상세 panel moved out of the left rail.
 * Only the clear button lives here: rendering still targets #memory-details,
 * which anchor-map-render.js owns.
 */
(function (global) {
  'use strict';

  const EMPTY_HTML = '<p class="m-empty">노드를 클릭하면 상세가 표시됩니다</p>';

  function clearDetails() {
    const details = global.document.getElementById('memory-details');
    if (details) {
      details.innerHTML = EMPTY_HTML;
    }
  }

  function init() {
    const button = global.document.getElementById('memory-inspector-clear');
    if (!button) return;
    button.addEventListener('click', clearDetails);
  }

  global.__MEMENTO_MEMORY_INSPECTOR__ = { clearDetails: clearDetails };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
