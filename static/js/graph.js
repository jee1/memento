    // ── 색상 맵 ──────────────────────────────────────────────
    const NODE_COLORS = {
      episodic:   '#818cf8',
      semantic:   '#34d399',
      procedural: '#fb923c',
      working:    '#94a3b8',
    };

    const EDGE_COLORS = {
      supports:        '#818cf8',
      related_to:      '#34d399',
      extracted_from:  '#fb923c',
      contradicts:     '#f87171',
      default:         '#475569',
    };

    const TYPE_BG = {
      episodic:   '#312e81',
      semantic:   '#064e3b',
      procedural: '#431407',
      working:    '#1e293b',
    };

    const TYPE_FG = {
      episodic:   '#a5b4fc',
      semantic:   '#6ee7b7',
      procedural: '#fdba74',
      working:    '#94a3b8',
    };

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
      const q = params.toString();
      return '/admin/graph' + (q ? '?' + q : '');
    }

    // ── D3 설정 ───────────────────────────────────────────────
    let simulation = null;

    function renderGraph(nodes, edges) {
      const container = document.getElementById('graph-container');
      const W = container.clientWidth;
      const H = container.clientHeight;

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
        .attr('stroke', d => EDGE_COLORS[d.relation_type] ?? EDGE_COLORS.default)
        .attr('stroke-width', d => Math.max(1, (d.confidence ?? 1) * 3));

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

      node.append('circle')
        .attr('r', d => rScale(d.importance))
        .attr('fill', d => NODE_COLORS[d.type] ?? '#94a3b8')
        .attr('stroke', d => d3.color(NODE_COLORS[d.type] ?? '#94a3b8').darker(0.5))
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

      simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });
    }

    // ── 상세 패널 (T019, T020) ────────────────────────────────
    function showDetail(d) {
      const typeBg = TYPE_BG[d.type] ?? '#1e293b';
      const typeFg = TYPE_FG[d.type] ?? '#94a3b8';
      const tagsHtml = (d.tags ?? []).length > 0
        ? `<div class="tag-list">${d.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>`
        : '<span style="color:#475569">없음</span>';

      detailContent.innerHTML = `
        <div class="detail-row">
          <div class="detail-label">타입</div>
          <div class="detail-value">
            <span class="type-badge" style="background:${typeBg};color:${typeFg}">${escHtml(d.type)}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">내용</div>
          <div class="detail-value">${escHtml(d.content)}</div>
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
          <div class="detail-value" style="font-family:monospace;font-size:10px;color:#64748b">${escHtml(d.id)}</div>
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
      d3.select(svgEl).selectAll('*').remove();
      if (simulation) { simulation.stop(); simulation = null; }

      try {
        const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const data = await res.json();
        showLoading(false);

        if (!data.nodes || data.nodes.length === 0) {
          showEmpty(true);
          return;
        }

        renderGraph(data.nodes, data.edges ?? []);

        if (data.meta?.truncated) {
          console.info(`[graph] 노드 제한 초과: 상위 ${data.nodes.length}개 표시`);
        }
      } catch (err) {
        showLoading(false);
        showError(err.message ?? '알 수 없는 오류');
      }
    }

    // ── 이벤트 바인딩 ─────────────────────────────────────────
    applyBtn.addEventListener('click', () => loadGraph(buildUrl()));

    resetBtn.addEventListener('click', () => {
      document.querySelectorAll('.type-check input').forEach(el => { el.checked = true; });
      impSlider.value = '0';
      impVal.textContent = '0.0';
      loadGraph('/admin/graph');
    });

    // 클릭 시 패널 닫기 (T020 — svgEl 외부 클릭)
    document.addEventListener('click', (event) => {
      if (!detailPanel.contains(event.target) && !svgEl.contains(event.target)) {
        closePanel();
      }
    });

    // ── 초기 로드 ─────────────────────────────────────────────
    loadGraph('/admin/graph');
