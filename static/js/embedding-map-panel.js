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
    st.detailRequestGeneration++;
    const panel = document.getElementById('em-side-panel');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  function parseTags(raw) {
    try {
      const tags = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
      return Array.isArray(tags) ? tags : [];
    } catch {
      return [];
    }
  }

  function renderSidePanel(point) {
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
    appendLabeledLine(body, 'ID:', String(point.id));
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

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'm-button m-button--secondary';
    copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', function () {
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(String(point.id));
      }
    });
    body.appendChild(copyBtn);

    panel.appendChild(header);
    panel.appendChild(body);

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeSidePanel();
    });
  }

  function openSidePanel(point) {
    st.detailRequestGeneration++;
    renderSidePanel(point);
  }

  st.closeSidePanel = closeSidePanel;
  st.openSidePanel = openSidePanel;
  st.openMemoryById = function openMemoryById(id) {
    if (!global.mementoAdminFetch) {
      return;
    }
    const generation = ++st.detailRequestGeneration;
    global
      .mementoAdminFetch('/admin/memory/items/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) throw new Error('memory detail request failed');
        return res.json();
      })
      .then(function (body) {
        if (generation !== st.detailRequestGeneration) return;
        const memory = body && body.memory;
        if (memory) {
          renderSidePanel({
            id: memory.id,
            type: memory.type,
            importance: memory.importance,
            created_at: memory.created_at,
            tags: parseTags(memory.tags),
            content: memory.content,
          });
        }
      })
      .catch(function () {
        if (generation !== st.detailRequestGeneration) return;
        st.renderEmbeddingHealthError('기억 상세를 불러오지 못했습니다.');
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
