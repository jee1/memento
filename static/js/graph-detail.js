/**
 * Memory Graph — detail panel (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_GRAPH__;
  if (!ns) {
    return;
  }

  function getTypeBadgeClass(type) {
    const normalizedType = String(type ?? '').toLowerCase();
    return ['episodic', 'semantic', 'procedural', 'working'].includes(normalizedType)
      ? `type-badge--${normalizedType}`
      : 'type-badge--default';
  }

  function buildTagsHtml(tags) {
    if ((tags ?? []).length === 0) {
      return '<span class="detail-empty">없음</span>';
    }
    return `<div class="tag-list">${tags.map((t) => `<span class="tag">${ns.escHtml(t)}</span>`).join('')}</div>`;
  }

  function buildDetailRows(d) {
    const escHtml = ns.escHtml;
    const badgeClass = getTypeBadgeClass(d.type);
    const contentNote = d.content_truncated
      ? '<div class="detail-empty">전체 로드 모드에서는 본문이 축약됩니다.</div>'
      : '';
    const created = d.created_at ? new Date(d.created_at).toLocaleString('ko-KR') : '-';

    return [
      `<div class="detail-row"><div class="detail-label">타입</div><div class="detail-value"><span class="type-badge ${badgeClass}">${escHtml(d.type)}</span></div></div>`,
      `<div class="detail-row"><div class="detail-label">내용</div><div class="detail-value">${escHtml(d.content)}${contentNote}</div></div>`,
      `<div class="detail-row"><div class="detail-label">중요도</div><div class="detail-value">${(d.importance ?? 0).toFixed(2)}</div></div>`,
      `<div class="detail-row"><div class="detail-label">생성일</div><div class="detail-value">${created}</div></div>`,
      `<div class="detail-row"><div class="detail-label">태그</div><div class="detail-value">${buildTagsHtml(d.tags)}</div></div>`,
      `<div class="detail-row"><div class="detail-label">고정</div><div class="detail-value">${d.pinned ? '📌 예' : '아니오'}</div></div>`,
      `<div class="detail-row"><div class="detail-label">ID</div><div class="detail-value detail-value--mono">${escHtml(d.id)}</div></div>`,
    ].join('');
  }

  ns.showDetail = function showDetail(d) {
    ns.dom.detailContent.innerHTML = buildDetailRows(d);
    ns.dom.detailPanel.style.display = 'block';
  };

  ns.closePanel = function closePanel() {
    ns.dom.detailPanel.style.display = 'none';
  };
})(typeof window !== 'undefined' ? window : globalThis);
