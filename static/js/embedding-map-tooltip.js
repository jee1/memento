/**
 * Embedding map tooltip helpers (#014, #546).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function ensureTooltip() {
    if (!st.tooltipEl) {
      st.tooltipEl = document.createElement('div');
      st.tooltipEl.className = 'em-tooltip';
      st.tooltipEl.style.cssText =
        'position:fixed;z-index:9999;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:4px;pointer-events:none;max-width:320px;display:none;';
      document.body.appendChild(st.tooltipEl);
    }
    return st.tooltipEl;
  }

  function showTooltip(event, point) {
    const el = ensureTooltip();
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    const preview = point.content.length > 80 ? point.content.slice(0, 80) + '…' : point.content;
    el.appendChild(document.createTextNode(preview));
    el.appendChild(document.createElement('br'));
    const typeSpan = document.createElement('span');
    typeSpan.style.opacity = '0.85';
    typeSpan.textContent = point.type;
    el.appendChild(typeSpan);
    el.style.display = 'block';
    el.style.left = event.clientX + 12 + 'px';
    el.style.top = event.clientY + 12 + 'px';
  }

  function hideTooltip() {
    if (st.tooltipEl) {
      st.tooltipEl.style.display = 'none';
    }
  }

  st.showTooltip = showTooltip;
  st.hideTooltip = hideTooltip;
})(typeof window !== 'undefined' ? window : globalThis);
