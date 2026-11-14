/**
 * Phone table cards (#1147/#1722): copy each column header into body cells' data-label so the
 * max-width: 30rem layout in dashboard.css can render every row as a "header: value" card.
 * Includes #rc-table (7 equal fixed columns were unreadable at 390). Empty header → 「선택」.
 * Rows rendered later are labelled too (MutationObserver).
 */
(function (global) {
  'use strict';

  function labelTable(table) {
    const heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) {
      const text = th.textContent.trim();
      if (text) {
        return text;
      }
      if (th.getAttribute('aria-label')) {
        return th.getAttribute('aria-label');
      }
      return '선택';
    });
    if (heads.length === 0) {
      return;
    }
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      let col = 0;
      Array.prototype.forEach.call(tr.children, function (cell) {
        const span = cell.colSpan || 1;
        if (cell.tagName === 'TD' && span === 1 && heads[col] && cell.getAttribute('data-label') !== heads[col]) {
          cell.setAttribute('data-label', heads[col]);
        }
        col += span;
      });
    });
  }

  function watch(table) {
    labelTable(table);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        labelTable(table);
      }).observe(table, { childList: true, subtree: true });
    }
  }

  if (global.document) {
    global.document.querySelectorAll('table.m-table').forEach(watch);
  }

  global.__MEMENTO_TABLE_CARDS__ = { labelTable: labelTable };
})(typeof window !== 'undefined' ? window : globalThis);
