    function readGraphToken(name, fallback = '') {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (value) {
        return value;
      }
      if (fallback) {
        return fallback;
      }
      throw new Error(`Missing CSS token: ${name}`);
    }

    function getGraphPalette() {
      return {
        nodeColors: {
          episodic: readGraphToken('--color-memory-episodic'),
          semantic: readGraphToken('--color-memory-semantic'),
          procedural: readGraphToken('--color-memory-procedural'),
          working: readGraphToken('--color-memory-working'),
          default: readGraphToken('--color-memory-neutral'),
        },
        edgeColors: {
          supports: readGraphToken('--color-memory-episodic'),
          related_to: readGraphToken('--color-memory-semantic'),
          extracted_from: readGraphToken('--color-memory-procedural'),
          contradicts: readGraphToken('--color-error'),
          default: readGraphToken('--color-graph-edge-default'),
        },
      };
    }

    function getNodeFillColor(type, palette) {
      return palette.nodeColors[type] ?? palette.nodeColors.default;
    }

    function getNodeStrokeColor(type, palette) {
      const fill = getNodeFillColor(type, palette);
      const color = d3.color(fill);
      return color ? color.darker(0.5).formatHex() : fill;
    }

    function getTypeBadgeClass(type) {
      const normalizedType = String(type ?? '').toLowerCase();
      return ['episodic', 'semantic', 'procedural', 'working'].includes(normalizedType)
        ? `type-badge--${normalizedType}`
        : 'type-badge--default';
    }

    // ── DOM refs ──────────────────────────────────────────────
    const svgEl      = document.getElementById('graph');
    const loadingEl  = document.getElementById('loading');
    const emptyEl    = document.getElementById('empty-msg');
    const errorEl    = document.getElementById('error-msg');
    const tooltip    = document.getElementById('tooltip');
    const detailPanel = document.getElementById('detail-panel');
    const detailContent = document.getElementById('detail-content');
    const impSlider  = document.getElementById('importance-slider');
    const impVal     = document.getElementById('importance-val');
    const applyBtn   = document.getElementById('apply-btn');
    const resetBtn   = document.getElementById('reset-btn');
    const searchInput = document.getElementById('graph-search');
    const searchBtn = document.getElementById('search-btn');
    const matchBadge = document.getElementById('graph-match-badge');
    const fullGraphToggle = document.getElementById('full-graph-toggle');
    const graphModeHint = document.getElementById('graph-mode-hint');

    // ── 슬라이더 표시 ─────────────────────────────────────────
    impSlider.addEventListener('input', () => {
      impVal.textContent = parseFloat(impSlider.value).toFixed(2);
    });

    // ── 필터 URL 구성 ─────────────────────────────────────────
    function buildUrl() {
      const checked = [...document.querySelectorAll('.type-check input:checked')]
        .map(el => el.value);
      const params = new URLSearchParams();
      if (checked.length < 4 && checked.length > 0) {
        params.set('types', checked.join(','));
      }
      const imp = parseFloat(impSlider.value);
      if (imp > 0) params.set('min_importance', imp.toFixed(2));
      if (fullGraphToggle.checked) {
        params.set('view', 'full');
        params.set('fields', 'minimal');
      }
      const q = params.toString();
      return '/admin/graph' + (q ? '?' + q : '');
    }

    // ── D3 설정 ───────────────────────────────────────────────
    let simulation = null;
    /** @type {unknown[] | null} */
    let lastGraphNodes = null;
    /** @type {unknown[] | null} */
    let lastGraphEdges = null;
    let resizeRedrawTimer = null;
    let lastGraphMeta = null;
    let activeSearchQuery = '';
    let renderedNodeSelection = null;
    let renderedLinkSelection = null;

    function renderGraph(nodes, edges) {
      const container = document.getElementById('graph-container');
      const W = container.clientWidth;
      const H = container.clientHeight;
      const palette = getGraphPalette();

      d3.select(svgEl).selectAll('*').remove();

      const svg = d3.select(svgEl)
        .attr('width', W)
        .attr('height', H);

      // zoom + pan (T032)
      const g = svg.append('g');
      svg.call(
        d3.zoom()
          .scaleExtent([0.1, 4])
          .on('zoom', event => {
            g.attr('transform', event.transform);
            // 빈 영역 클릭 시 패널 닫기
            if (event.sourceEvent && event.sourceEvent.type === 'click') {
              closePanel();
            }
          })
      );

      // 빈 영역 클릭 → 패널 닫기
      svg.on('click', (event) => {
        if (event.target === svgEl || event.target.tagName === 'svg') {
          closePanel();
        }
      });

      // importance 기반 노드 반지름
      const rScale = d3.scaleLinear()
        .domain([0, 1])
        .range([6, 22])
        .clamp(true);

      // force simulation (T013)
      simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide().radius(d => rScale(d.importance) + 4));

      // 엣지 (T014)
      const link = g.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(edges)
        .enter().append('line')
        .attr('class', 'link')
        .attr('stroke', d => palette.edgeColors[d.relation_type] ?? palette.edgeColors.default)
        .attr('stroke-width', d => Math.max(1, (d.confidence ?? 1) * 3));
      renderedLinkSelection = link;

      // 노드 그룹 (T013)
      const node = g.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodes)
        .enter().append('g')
        .attr('class', 'node')
        .call(
          // 드래그 (T031)
          d3.drag()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (event, d) => {
              d.fx = event.x; d.fy = event.y;
            })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null; d.fy = null;
            })
        );
      renderedNodeSelection = node;

      node.append('circle')
        .attr('r', d => {
          d.__graphRadius = rScale(d.importance);
          return d.__graphRadius;
        })
        .attr('fill', d => getNodeFillColor(d.type, palette))
        .attr('stroke', d => getNodeStrokeColor(d.type, palette))
        // 마우스오버 툴팁 (T018)
        .on('mouseover', (event, d) => {
          tooltip.style.display = 'block';
          tooltip.textContent = d.label;
        })
        .on('mousemove', (event) => {
          tooltip.style.left = (event.clientX + 12) + 'px';
          tooltip.style.top  = (event.clientY - 10) + 'px';
        })
        .on('mouseout', () => {
          tooltip.style.display = 'none';
        })
        // 클릭 → 상세 패널 (T019)
        .on('click', (event, d) => {
          event.stopPropagation();
          showDetail(d);
        });

      node.append('text')
        .attr('dy', d => rScale(d.importance) + 12)
        .attr('text-anchor', 'middle')
        .text(d => d.label.length > 18 ? d.label.slice(0, 18) + '…' : d.label);

      applySearchHighlight();

      simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });
    }

    function normalizeSearchText(value) {
      return String(value ?? '').trim().toLocaleLowerCase('ko-KR');
    }

    function getSearchHaystack(node) {
      return [
        node.content,
        node.summary,
        node.label,
        ...(Array.isArray(node.tags) ? node.tags : []),
      ].map(value => String(value ?? '')).join(' ').toLocaleLowerCase('ko-KR');
    }

    function getNodeId(edgeEndpoint) {
      return typeof edgeEndpoint === 'object' && edgeEndpoint !== null ? edgeEndpoint.id : edgeEndpoint;
    }

    function setMatchBadge(count, total) {
      if (!activeSearchQuery) {
        matchBadge.style.display = 'none';
        matchBadge.textContent = '';
        return;
      }
      matchBadge.textContent = `${count}개 노드 매칭`;
      matchBadge.style.display = 'inline-block';
      if (total > 0 && count === 0) {
        matchBadge.textContent = '0개 노드 매칭';
      }
    }

    function applySearchHighlight() {
      const nodes = Array.isArray(lastGraphNodes) ? lastGraphNodes : [];
      const query = normalizeSearchText(activeSearchQuery);
      const hasQuery = query.length > 0;
      const matchingIds = new Set();

      if (hasQuery) {
        for (const node of nodes) {
          if (getSearchHaystack(node).includes(query)) {
            matchingIds.add(node.id);
          }
        }
      }

      setMatchBadge(matchingIds.size, nodes.length);

      if (!renderedNodeSelection || !renderedLinkSelection) {
        return;
      }

      renderedNodeSelection
        .classed('search-match', d => hasQuery && matchingIds.has(d.id))
        .classed('search-dim', d => hasQuery && !matchingIds.has(d.id));

      renderedNodeSelection.select('circle')
        .attr('r', d => hasQuery && matchingIds.has(d.id)
          ? (d.__graphRadius ?? 8) * 1.25
          : (d.__graphRadius ?? 8));

      renderedLinkSelection
        .classed('search-dim', d => {
          if (!hasQuery) return false;
          return !matchingIds.has(getNodeId(d.source)) && !matchingIds.has(getNodeId(d.target));
        });
    }

    function applySearchFromInput() {
      activeSearchQuery = searchInput.value;
      applySearchHighlight();
    }

    function updateGraphModeHint(meta) {
      if (!meta) {
        graphModeHint.style.display = 'none';
        graphModeHint.textContent = '';
        return;
      }
      const total = meta.total_available_nodes ?? meta.total_nodes ?? 0;
      const shown = meta.total_nodes ?? 0;
      const mode = meta.graph_view === 'full' ? '전체' : '기본';
      const suffix = meta.truncated ? ` / ${total}개 중 ${shown}개 표시` : ` / ${shown}개 표시`;
      graphModeHint.textContent = `${mode} 모드${suffix}`;
      graphModeHint.style.display = 'inline';
    }

    // ── 상세 패널 (T019, T020) ────────────────────────────────
    function showDetail(d) {
      const badgeClass = getTypeBadgeClass(d.type);
      const tagsHtml = (d.tags ?? []).length > 0
        ? `<div class="tag-list">${d.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>`
        : '<span class="detail-empty">없음</span>';
      const contentNote = d.content_truncated
        ? '<div class="detail-empty">전체 로드 모드에서는 본문이 축약됩니다.</div>'
        : '';

      detailContent.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">타입</div>
          <div class="detail-value">
            <span class="type-badge ${badgeClass}">${escHtml(d.type)}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">내용</div>
          <div class="detail-value">${escHtml(d.content)}${contentNote}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">중요도</div>
          <div class="detail-value">${(d.importance ?? 0).toFixed(2)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">생성일</div>
          <div class="detail-value">${d.created_at ? new Date(d.created_at).toLocaleString('ko-KR') : '-'}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">태그</div>
          <div class="detail-value">${tagsHtml}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">고정</div>
          <div class="detail-value">${d.pinned ? '📌 예' : '아니오'}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">ID</div>
          <div class="detail-value detail-value--mono">${escHtml(d.id)}</div>
        </div>
      `;
      detailPanel.style.display = 'block';
    }

    function closePanel() {
      detailPanel.style.display = 'none';
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ── 상태 표시 헬퍼 ────────────────────────────────────────
    function showLoading(v)  { loadingEl.style.display  = v ? 'block' : 'none'; }
    function showEmpty(v)    { emptyEl.style.display    = v ? 'block' : 'none'; }
    function showError(msg)  {
      errorEl.innerHTML = `⚠️ ${escHtml(msg)}`;
      errorEl.style.display = 'block';
    }
    function clearStatus() {
      loadingEl.style.display = 'none';
      emptyEl.style.display   = 'none';
      errorEl.style.display   = 'none';
    }

    // ── 데이터 로드 ───────────────────────────────────────────
    async function loadGraph(url) {
      clearStatus();
      showLoading(true);
      lastGraphNodes = null;
      lastGraphEdges = null;
      lastGraphMeta = null;
      renderedNodeSelection = null;
      renderedLinkSelection = null;
      updateGraphModeHint(null);
      d3.select(svgEl).selectAll('*').remove();
      if (simulation) { simulation.stop(); simulation = null; }

      try {
        const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const data = await res.json();
        showLoading(false);
        lastGraphMeta = data.meta ?? null;
        updateGraphModeHint(lastGraphMeta);

        if (!data.nodes || data.nodes.length === 0) {
          applySearchHighlight();
          showEmpty(true);
          return;
        }

        const edges = data.edges ?? [];
        lastGraphNodes = data.nodes;
        lastGraphEdges = edges;
        renderGraph(data.nodes, edges);

      } catch (err) {
        showLoading(false);
        const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류';
        showError(errorMessage);
      }
    }

    // ── 이벤트 바인딩 ─────────────────────────────────────────
    applyBtn.addEventListener('click', () => {
      activeSearchQuery = searchInput.value;
      loadGraph(buildUrl());
    });
    searchBtn.addEventListener('click', applySearchFromInput);
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applySearchFromInput();
      }
    });
    searchInput.addEventListener('input', () => {
      if (searchInput.value.trim() === '' && activeSearchQuery !== '') {
        activeSearchQuery = '';
        applySearchHighlight();
      }
    });

    resetBtn.addEventListener('click', () => {
      document.querySelectorAll('.type-check input').forEach(el => { el.checked = true; });
      impSlider.value = '0';
      impVal.textContent = '0.0';
      searchInput.value = '';
      activeSearchQuery = '';
      fullGraphToggle.checked = false;
      loadGraph('/admin/graph');
    });

    // 클릭 시 패널 닫기 (T020 — svgEl 외부 클릭)
    document.addEventListener('click', (event) => {
      if (!detailPanel.contains(event.target) && !svgEl.contains(event.target)) {
        closePanel();
      }
    });

    // 대시보드 iframe 탭 전환 등에서 전달되는 resize에 맞춰 캔버스 재계산.
    // 현재는 renderGraph 전체를 다시 그리며 force simulation을 새로 시작한다.
    // 대형 그래프에서는 레이아웃이 흔들릴 수 있으므로, 필요 시 "크기만 조정·시뮬 유지" 경로는 별도 이슈로 다루는 것이 좋다.
    window.addEventListener('resize', () => {
      if (!lastGraphNodes || lastGraphNodes.length === 0) {
        return;
      }
      clearTimeout(resizeRedrawTimer);
      resizeRedrawTimer = setTimeout(() => {
        renderGraph(/** @type {any[]} */ (lastGraphNodes), /** @type {any[]} */ (lastGraphEdges ?? []));
      }, 120);
    });

    // ── 초기 로드 ─────────────────────────────────────────────
    loadGraph('/admin/graph');
