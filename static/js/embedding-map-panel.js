/**
 * Embedding map side panel (#014, #546).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function appendLabeledLine(parent, label, valueText) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = label;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' ' + valueText));
    parent.appendChild(p);
  }

  function closeSidePanel() {
    const panel = document.getElementById('em-side-panel');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  function openSidePanel(point) {
    const panel = document.getElementById('em-side-panel');
    if (!panel) {
      return;
    }
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
    const tags = Array.isArray(point.tags) ? point.tags.join(', ') : '';
    const imp = typeof point.importance === 'number' ? point.importance.toFixed(2) : String(point.importance);

    const header = document.createElement('div');
    header.className = 'em-panel-header';
    const h3 = document.createElement('h3');
    h3.textContent = 'Memory';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'em-panel-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    header.appendChild(h3);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'em-panel-body';
    appendLabeledLine(body, 'Type:', String(point.type));
    appendLabeledLine(body, 'Importance:', imp);
    appendLabeledLine(body, 'Created:', String(point.created_at));
    appendLabeledLine(body, 'Tags:', tags);

    const hr = document.createElement('hr');
    const pre = document.createElement('pre');
    pre.className = 'em-panel-content';
    pre.textContent = String(point.content);
    body.appendChild(hr);
    body.appendChild(pre);

    panel.appendChild(header);
    panel.appendChild(body);

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeSidePanel();
    });
  }

  st.closeSidePanel = closeSidePanel;
  st.openSidePanel = openSidePanel;
})(typeof window !== 'undefined' ? window : globalThis);
