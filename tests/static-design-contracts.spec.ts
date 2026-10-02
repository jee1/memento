import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readStaticFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

function extractAtMediaBlock(source: string, query: string): string {
  const needle = `@media ${query}`;
  const start = source.indexOf(needle);
  if (start < 0) return '';
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return source.slice(start, end + 1);
}

function extractAllAtMediaBlocks(source: string, query: string): string {
  const needle = `@media ${query}`;
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start < 0) break;
    const block = extractAtMediaBlock(source.slice(start), query);
    blocks.push(block);
    from = start + Math.max(block.length, needle.length);
  }
  return blocks.join('\n');
}

function extractNamedFunction(source: string, name: string): string {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);
  if (start < 0) return '';
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return source.slice(start, end + 1);
}

function getFunctionMetrics(source: string): Array<{ name: string; lines: number; complexity: number }> {
  const functionStarts = source.matchAll(/function\s+([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g);
  const metrics: Array<{ name: string; lines: number; complexity: number }> = [];
  for (const match of functionStarts) {
    const start = match.index ?? 0;
    let depth = 0;
    let end = start;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    const name = match[1] || '<anonymous>';
    const body = source.slice(start, end + 1);
    const branches = body.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g) ?? [];
    metrics.push({ name, lines: body.split('\n').length, complexity: branches.length + 1 });
  }
  return metrics;
}

describe('static design contracts', () => {
  it('anchor-map.js avoids console calls, hex colors, and inline html styles', () => {
    const anchorMapFiles = [
      'static/js/anchor-map-shared.js',
      'static/js/anchor-map-layout.js',
      'static/js/anchor-map-render.js',
      'static/js/anchor-map-search.js',
      'static/js/anchor-map-data.js',
      'static/js/anchor-map-ws.js',
      'static/js/anchor-map.js',
    ].map(readStaticFile).join('\n');

    expect(anchorMapFiles).not.toContain('console.');
    expect(anchorMapFiles).not.toMatch(/#[0-9A-Fa-f]{3,8}(?![0-9A-Za-z_-])/);
    expect(anchorMapFiles).not.toMatch(/style\s*=/);
  });

  it('anchor-map.js uses session-protected /api/anchors/search instead of /tools/search_local', () => {
    // /api/anchors/search lives in the search module after the god-function split (#596)
    const source = readStaticFile('static/js/anchor-map-search.js');

    expect(source).toContain('/api/anchors/search');
    expect(source).not.toContain('/tools/search_local');
  });

  it('anchor-map.js emits observable debug events for document-level listeners', () => {
    // debugAnchorMap lives in the shared module after the god-function split (#596)
    const source = readStaticFile('static/js/anchor-map-shared.js');

    expect(source).toMatch(/document\.dispatchEvent\(new CustomEvent\('memento:debug', \{/);
    expect(source).toMatch(/bubbles:\s*true/);
    expect(source).toMatch(/composed:\s*true/);
  });

  it('issue 871 search context renders details from the search item, not the map node', () => {
    const searchSource = readStaticFile('static/js/anchor-map-search.js');
    const entrySource = readStaticFile('static/js/anchor-map.js');

    // selectNode renders map-node similarity (anchor axis); search results must use their own value
    expect(searchSource).toContain('ns.displaySearchResultDetails(item)');
    expect(searchSource).not.toContain('ns.selectNode(');
    expect(entrySource).not.toContain('ns.selectNode(');
    expect(searchSource).toContain('ns.markNodeSelected(id)');
  });

  it('issue 872 empty anchor map renders a message instead of a blank canvas', () => {
    const renderSource = readStaticFile('static/js/anchor-map-render.js');
    const cssSource = readStaticFile('static/css/dashboard.css');

    expect(renderSource).toContain("setMapStatusMessage('empty'");
    expect(renderSource).toContain("empty: 'map-empty-message'");
    expect(cssSource).toContain('.map-empty-message');
  });

  it('issue 904 map load failures render an in-map error state, not an alert', () => {
    const renderSource = readStaticFile('static/js/anchor-map-render.js');
    const dataSource = readStaticFile('static/js/anchor-map-data.js');
    const wsSource = readStaticFile('static/js/anchor-map-ws.js');
    const cssSource = readStaticFile('static/css/dashboard.css');

    // 빈 상태와 오류 상태는 서로 다른 클래스여야 한다 (AC 2)
    expect(renderSource).toContain("error: 'map-error-message'");
    expect(renderSource).toContain("empty: 'map-empty-message'");
    expect(cssSource).toContain('.map-error-message');
    expect(cssSource).toContain('.map-loading-message');

    // 맵 로드 실패는 alert 가 아니라 in-map 상태로 나간다 (AC 1)
    expect(dataSource).not.toContain('alert(');
    expect(dataSource).toContain("ns.setMapStatusMessage('error'");
    // auto-refresh 여부로 알림을 억제하던 분기가 사라졌다 (AC 3)
    expect(dataSource).not.toContain('if (!state.autoRefreshInterval)');
    // 성공 응답은 내용이 그대로여도 오류를 해제한다 (I3)
    expect(dataSource).toContain('ns.setMapStatusMessage(null)');

    // 실시간 경로 실패도 같은 in-map 오류를 쓴다
    expect(wsSource).toContain("ns.setMapStatusMessage('error'");
  });

  it('issue 949 websocket pushes go through the same normalization as the HTTP path', () => {
    const wsSource = readStaticFile('static/js/anchor-map-ws.js');
    const sharedSource = readStaticFile('static/js/anchor-map-shared.js');

    expect(sharedSource).toContain('ns.isMapDataShapeValid');
    expect(wsSource).toContain('ns.normalizeMapData(message.data)');
    expect(wsSource).toContain('ns.isMapDataShapeValid(message.data)');
    expect(wsSource).not.toContain('state.mapData = message.data');
  });

  it('issue 954 the HTTP load path validates shape before normalizing', () => {
    const dataSource = readStaticFile('static/js/anchor-map-data.js');

    expect(dataSource).toContain('ns.isMapDataShapeValid(');
    // 검증 없이 바로 정규화하던 형태로 되돌아가지 않는다
    expect(dataSource).not.toContain('ns.normalizeMapData(await response.json())');
  });

  it('issue 874 anchor map drops the stub button, the duplicate load button, and the d3 CDN', () => {
    const renderSource = readStaticFile('static/js/anchor-map-render.js');
    const entrySource = readStaticFile('static/js/anchor-map.js');
    const searchSource = readStaticFile('static/js/anchor-map-search.js');
    const dashboardSource = readStaticFile('static/dashboard.html');
    const graphSource = readStaticFile('static/graph.html');
    const serverSource = readStaticFile('packages/memento-server/src/server/http-server.ts');

    // 미구현 alert 스텁 버튼과 Refresh 와 중복이던 Load Map 버튼
    expect(renderSource).not.toContain('changeAnchor');
    expect(entrySource).not.toContain('load-map-btn');
    expect(dashboardSource).not.toContain('load-map-btn');

    // 확대를 되돌릴 Fit 버튼
    expect(dashboardSource).toContain('id="fit-btn"');
    expect(entrySource).toContain('ns.fitToNodes');

    // 검색 결과 목록은 처음부터 전부 그리지 않는다
    expect(searchSource).toContain('SEARCH_RESULT_PAGE_SIZE');
    expect(searchSource).toContain('js-search-result-more');

    // d3 는 npm 의존성에서 서빙한다 — CDN 없이도 렌더되고 CSP 에 외부 출처가 없다
    expect(dashboardSource).not.toContain('d3js.org');
    expect(graphSource).not.toContain('d3js.org');
    expect(dashboardSource).toContain('/static/vendor/d3.v7.min.js');
    expect(graphSource).toContain('/static/vendor/d3.v7.min.js');
    expect(serverSource).toContain("app.get('/static/vendor/d3.v7.min.js'");
    expect(serverSource).toMatch(/scriptSrc: \["'self'"\],/);
  });

  it('token readers fail in a bounded way when a required token is missing', () => {
    // readAnchorMapToken lives in the shared module after the god-function split (#596)
    const anchorMapSource = readStaticFile('static/js/anchor-map-shared.js');
    const graphSource = readStaticFile('static/js/graph-shared.js');

    expect(anchorMapSource).toMatch(/function readAnchorMapToken\(name, fallback = ''\)/);
    expect(anchorMapSource).toMatch(/throw new Error\(`Missing CSS token: \$\{name\}`\);/);
    expect(graphSource).toMatch(/function readGraphToken\(name, fallback = ''\)/);
    expect(graphSource).toMatch(/throw new Error\(`Missing CSS token: \$\{name\}`\);/);
  });

  it('graph modules read colors from tokens instead of hardcoded hex or inline styles', () => {
    const source = [
      'graph-shared.js',
      'graph-render.js',
      'graph-detail.js',
      'graph-search.js',
      'graph-fetch.js',
      'graph.js',
    ]
      .map((name) => readStaticFile('static/js/' + name))
      .join('\n');

    expect(source).not.toMatch(/#[0-9A-Fa-f]{3,8}(?![0-9A-Za-z_-])/);
    expect(source).not.toMatch(/style\s*=/);
  });

  it('graph.html avoids inline color/background styles and hardcoded hex colors', () => {
    const source = readStaticFile('static/graph.html');

    expect(source).not.toMatch(/style\s*=\s*['"][^'"]*(?:color|background)/);
    expect(source).not.toMatch(/#[0-9A-Fa-f]{3,8}(?![0-9A-Za-z_-])/);
  });

  it('dashboard graph iframe loads embed mode for consistent light dashboard styling', () => {
    const tabsSource = [
      'dashboard-tabs-panels.js',
      'dashboard-tabs-init.js',
      'dashboard-tabs.js',
    ]
      .map((name) => readStaticFile('static/js/' + name))
      .join('\n');
    const graphSource = readStaticFile('static/graph.html');
    const embedInitSource = readStaticFile('static/js/graph-embed-init.js');

    expect(tabsSource).toContain("'/graph?embed=dashboard'");
    expect(graphSource).toContain('graph-view--embedded');
    expect(graphSource).toContain('/static/js/graph-embed-init.js');
    expect(graphSource).not.toMatch(/<script>\s*\(function\s*\(\)/);
    expect(embedInitSource).toContain("params.get('embed') === 'dashboard'");
    expect(embedInitSource).toContain('graph-view--embedded');
  });

  it('dashboard.css uses tokens for tab hover and auth messaging colors', () => {
    const source = readStaticFile('static/css/dashboard.css');

    expect(source).not.toContain('rgba(255, 255, 255, 0.6)');
    expect(source).not.toContain('rgba(255, 255, 255, 0.88)');
    expect(source).not.toContain('#fee2e2');
  });

  it('components.css uses tokens instead of direct white/rgba color literals', () => {
    const source = readStaticFile('static/css/components.css');

    expect(source).not.toContain('color: white;');
    expect(source).not.toContain('background: rgba(');
    expect(source).not.toContain('border: 1px solid rgba(');
  });

  it('issue #836 graph hides degree-0 nodes behind an off-by-default toggle in both embed and standalone', () => {
    const graphSource = readStaticFile('static/graph.html');
    const sharedSource = readStaticFile('static/js/graph-shared.js');
    const fetchSource = readStaticFile('static/js/graph-fetch.js');
    const entrySource = readStaticFile('static/js/graph.js');

    // 기본 off — checked 속성이 붙으면 #126 고립 발견 use-case 가 깨진다
    expect(graphSource).toMatch(/<input type="checkbox" id="hide-orphans-toggle">/);
    expect(graphSource).toContain('id="orphan-hidden-badge"');
    // embed 에서도 보이는 필터 그룹 안에 있어야 한다 (auth 패널처럼 숨겨지면 안 됨)
    expect(graphSource).toMatch(
      /filter-group graph-session-only[\s\S]{0,400}id="hide-orphans-toggle"/
    );
    // 판정은 순수 함수로 shared 에 — embed/standalone 분기 없음
    expect(sharedSource).toContain('function filterConnectedNodes(nodes, edges)');
    expect(graphSource).not.toContain("embed') === 'dashboard'"); // 로직 분기 금지
    expect(fetchSource).toContain('개 숨김');
    expect(fetchSource).toContain('ns.renderVisibleGraph');
    // 초기화는 토글을 기본값으로 되돌린다
    expect(entrySource).toContain('orphanToggle.checked = false');
  });

  it('issue #950 graph badges defer textContent until visible for aria-live', () => {
    const graphSource = readStaticFile('static/graph.html');
    const sharedSource = readStaticFile('static/js/graph-shared.js');
    const fetchSource = readStaticFile('static/js/graph-fetch.js');
    const searchSource = readStaticFile('static/js/graph-search.js');

    expect(sharedSource).toContain('function setBadgeText(el, text)');
    expect(fetchSource).not.toMatch(/orphanBadge\.style\.display/);
    expect(fetchSource).not.toMatch(/orphanBadge\.textContent/);
    expect(searchSource).not.toMatch(/matchBadge\.style\.display/);
    expect(searchSource).not.toMatch(/matchBadge\.textContent/);
    expect(fetchSource).toContain('ns.setBadgeText');
    expect(searchSource).toContain('ns.setBadgeText');
    expect(graphSource).toMatch(
      /#graph-match-badge,\s*\n\s*#orphan-hidden-badge,[\s\S]{0,80}display: none;/
    );
    expect(graphSource).toContain('id="graph-match-badge" aria-live="polite"');
    expect(graphSource).toContain('id="orphan-hidden-badge" aria-live="polite"');
  });

  it('issue #616 admin static modules keep individual functions bounded', () => {
    const files = [
      'static/js/review-candidates-panel-poll-boot.js',
      'static/js/review-candidates-panel-poll-config.js',
      'static/js/review-candidates-panel-poll-badge.js',
      'static/js/review-candidates-panel-poll-prompt.js',
      'static/js/review-candidates-panel-poll-toast.js',
      'static/js/review-candidates-panel-poll-notify-os.js',
      'static/js/review-candidates-panel-poll-snapshot.js',
      'static/js/review-candidates-panel-poll-fetch.js',
      'static/js/review-candidates-panel-poll-cycle.js',
      'static/js/review-candidates-panel-poll-stream.js',
      'static/js/review-candidates-panel-poll.js',
      'static/js/dashboard-auth-state.js',
      'static/js/dashboard-auth-dom.js',
      'static/js/dashboard-auth-render-tabs.js',
      'static/js/dashboard-auth-render-message.js',
      'static/js/dashboard-auth-render-form.js',
      'static/js/dashboard-auth-render-status.js',
      'static/js/dashboard-auth-render.js',
      'static/js/dashboard-auth-ui.js',
      'static/js/dashboard-auth-error.js',
      'static/js/dashboard-auth-session-check.js',
      'static/js/dashboard-auth-sign-in.js',
      'static/js/dashboard-auth-requests.js',
      'static/js/dashboard-auth.js',
    ];
    const violations = files.flatMap((file) =>
      getFunctionMetrics(readStaticFile(file))
        .filter((entry) => entry.lines > 50 || entry.complexity > 15)
        .map((entry) => `${file}:${entry.name}:lines=${entry.lines}:complexity=${entry.complexity}`),
    );

    expect(violations).toEqual([]);
  });

  it('issue 894 anchor map pins dragged nodes and exposes manual layout controls', () => {
    const renderSource = readStaticFile('static/js/anchor-map-render.js');
    const layoutSource = readStaticFile('static/js/anchor-map-layout.js');
    const dashboardSource = readStaticFile('static/dashboard.html');
    const cssSource = readStaticFile('static/css/dashboard.css');

    // 드래그로 의미 있게 움직인 경우 fx/fy 를 풀면 #894 가 재발한다.
    // 클릭(미소이동) 경로의 d.fx=null 은 정상 — dragended 전체·거리 창으로 금지하면 안 됨.
    const dragendedFn = extractNamedFunction(renderSource, 'dragended');
    expect(dragendedFn).toContain('function dragended');
    const pinBranchMatch = dragendedFn.match(
      /if\s*\(\s*moved\s*>=\s*PIN_DRAG_THRESHOLD_PX\s*\)\s*\{([\s\S]*?)\}\s*else/,
    );
    expect(pinBranchMatch).not.toBeNull();
    const pinBranch = pinBranchMatch![1];
    expect(pinBranch).toContain('d.pinned = true');
    expect(pinBranch).not.toMatch(/d\.fx\s*=\s*null/);
    expect(renderSource).toContain('d.pinned = true');

    expect(layoutSource).toContain("ns.LAYOUT_STORAGE_KEY = 'memento.anchorMap.layout.v1'");
    expect(layoutSource).toContain('mergeNodeLayout');

    expect(dashboardSource).toContain('id="layout-mode-btn"');
    expect(dashboardSource).toContain('id="unpin-all-btn"');
    expect(dashboardSource).toContain('id="layout-reset-btn"');
    expect(dashboardSource).toContain('/static/js/anchor-map-layout.js');
    expect(cssSource).toContain('.node.pinned');
  });

  it('issue 948 anchor map defers refresh renders while a drag is in flight', () => {
    const renderSource = readStaticFile('static/js/anchor-map-render.js');
    const sharedSource = readStaticFile('static/js/anchor-map-shared.js');
    const entrySource = readStaticFile('static/js/anchor-map.js');

    expect(sharedSource).toContain('activeDragCount');
    expect(sharedSource).toContain('pendingRefreshRender');
    // 가드는 호출부가 아니라 renderMap 안에 있어야 한다 (새 호출부가 생겨도 안전)
    expect(extractNamedFunction(renderSource, 'renderMap')).toMatch(/state\.activeDragCount\s*>\s*0/);
    // 갱신은 버리지 않고 지연한다 — 플래그를 세우고 dragended 가 흘려보낸다
    expect(extractNamedFunction(renderSource, 'renderMap')).toContain('state.pendingRefreshRender = true');
    expect(extractNamedFunction(renderSource, 'dragended')).toContain('flushDeferredRender');
    expect(extractNamedFunction(renderSource, 'dragstarted')).toContain('state.activeDragCount += 1');
    // mouseup 안전망 (touchend 는 멀티터치를 끊으므로 등록하지 않는다)
    expect(entrySource).toContain("window.addEventListener('mouseup', ns.releaseDragDeferral)");
    expect(entrySource).not.toContain("addEventListener('touchend'");
  });

  it('issue 968 anchor map toolbar uses progressive disclosure with keyboard-accessible More', () => {
    const dashboardSource = readStaticFile('static/dashboard.html');
    const componentsSource = readStaticFile('static/css/components.css');
    const cssSource = readStaticFile('static/css/dashboard.css');

    expect(componentsSource).toContain('.m-toolbar');
    expect(componentsSource).toContain('.m-toolbar-primary');
    expect(componentsSource).toContain('.m-toolbar-more');

    expect(dashboardSource).toContain('class="anchor-map-toolbar m-toolbar"');
    expect(dashboardSource).toContain('class="m-toolbar-primary"');
    // #969 KO-first: visible summary label is 더보기 (structure still .m-toolbar-more)
    expect(dashboardSource).toMatch(/<details class="m-toolbar-more">[\s\S]*?<summary[\s\S]*?>더보기<\/summary>/);

    const primaryMatch = dashboardSource.match(
      /<div class="m-toolbar-primary">([\s\S]*?)<\/div>\s*<details class="m-toolbar-more">/,
    );
    expect(primaryMatch).not.toBeNull();
    const primary = primaryMatch![1];
    expect(primary).toContain('id="agent-id-select"');
    expect(primary).toContain('id="search-query-input"');
    expect(primary).toContain('id="search-slot-select"');
    expect(primary).toContain('id="search-btn"');
    expect(primary).toContain('id="clear-search-btn"');
    expect(primary).not.toContain('id="refresh-btn"');
    expect(primary).not.toContain('id="fit-btn"');
    expect(primary).not.toContain('id="layout-mode-btn"');
    expect(primary).not.toContain('id="auto-refresh-toggle"');

    const moreMatch = dashboardSource.match(
      /<details class="m-toolbar-more">([\s\S]*?)<\/details>/,
    );
    expect(moreMatch).not.toBeNull();
    const more = moreMatch![1];
    expect(more).toContain('id="refresh-btn"');
    expect(more).toContain('id="fit-btn"');
    expect(more).toContain('id="layout-mode-btn"');
    expect(more).toContain('id="unpin-all-btn"');
    expect(more).toContain('id="layout-reset-btn"');
    expect(more).toContain('id="auto-refresh-toggle"');
    expect(more).toContain('id="refresh-interval-select"');

    // hover-only disclosure 금지 — native details/summary
    expect(dashboardSource).not.toMatch(/\.m-toolbar-more:hover/);
    expect(componentsSource).not.toMatch(/\.m-toolbar-more:hover/);

    expect(cssSource).toMatch(/#anchor-map\s*\{[^}]*min-height:\s*200px;/s);
  });

  it('issue #1023 chrome carries no brand gradient, indigo literal, or forked mono stack', () => {
    const tokensSource = readStaticFile('static/css/tokens.css');
    const cssSource = readStaticFile('static/css/dashboard.css');

    // the gradient token is retired, not merely unused
    expect(tokensSource).not.toContain('--color-brand-gradient');
    expect(cssSource).not.toContain('--color-brand-gradient');

    // indigo also hides in rgb() form, which a `667eea` grep misses
    expect(cssSource).not.toContain('102, 126, 234');

    // one mono source: no panel rule may declare its own stack
    expect(tokensSource).toContain('--font-family-mono:');
    expect(cssSource).not.toContain('monospace');
    expect(cssSource).not.toContain('--font-mono,');
  });

  it('issue #1024 tables and metrics read one primitive instead of three panel forks', () => {
    const componentsSource = readStaticFile('static/css/components.css');
    const cssSource = readStaticFile('static/css/dashboard.css');
    const html = readStaticFile('static/dashboard.html');

    // the primitives exist, with the states the panels used to fork
    expect(componentsSource).toContain('.m-table {');
    expect(componentsSource).toContain('.m-metric-grid {');
    expect(componentsSource).toContain('.m-table tbody tr.is-selected');

    // no panel keeps its own table or metric chrome
    expect(cssSource).not.toContain('.rc-health-table {');
    expect(cssSource).not.toContain('.review-candidates-table {');
    expect(cssSource).not.toContain('.jobs-table {');
    expect(cssSource).not.toContain('rc-health-metric');
    expect(cssSource).not.toContain('--font-size-md');

    // and no panel borrows another panel's prefix in the markup
    expect(html).not.toContain('rc-health-metric');
  });

  it('issue #1025 ops strip reuses /admin/status and degrades quietly', () => {
    const html = readStaticFile('static/dashboard.html');
    const cssSource = readStaticFile('static/css/dashboard.css');
    const stripSource = readStaticFile('static/js/ops-strip.js');

    // session-gated chrome, but never hidden by a class nothing removes
    expect(html).toContain('id="ops-strip"');
    expect(html).toMatch(/id="ops-strip"[^>]*class="ops-strip session-only"/);
    expect(cssSource).toContain('.ops-strip {');

    // the four labels stay the words the 상태 tab already uses (#1048 lexicon)
    for (const label of ['임베딩 문제', '검토 대기', '실패 실행', '지금']) {
      expect(html).toContain('<span class="ops-strip__label">' + label + '</span>');
    }

    // no new endpoint, no polling, no console, and failures fall back to dashes
    expect(stripSource).toContain("'/admin/status'");
    expect(stripSource).not.toContain('setInterval');
    expect(stripSource).not.toContain('console.');
  });

  it('issue #1025 memory detail lives in its own inspector, not the left rail', () => {
    const html = readStaticFile('static/dashboard.html');
    const cssSource = readStaticFile('static/css/dashboard.css');

    // the left rail no longer stacks a third scrollable section
    expect(html).not.toContain('<section class="memory-details">');

    // native details, so the narrow layout collapses without a JS toggle
    expect(html).toMatch(/<details id="memory-inspector"[^>]*open>/);
    expect(cssSource).toContain('.memory-inspector {');

    // the render target id is unchanged, and the empty state is the shared primitive
    expect(html).toContain('<div id="memory-details">');
    expect(html).toContain('<p class="m-empty">노드를 클릭하면 상세가 표시됩니다</p>');
  });

  it('#897: 좁은 화면에서 후보 표만 가로 스크롤하고 미리보기는 눌리지 않는다', () => {
    const cssSource = readStaticFile('static/css/dashboard.css');
    const narrowBlock = extractAllAtMediaBlocks(cssSource, '(max-width: 30rem)');

    expect(narrowBlock).toContain('@media (max-width: 30rem)');
    expect(narrowBlock).toMatch(/\.review-candidates-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
    expect(narrowBlock).toMatch(/\.rc-preview-aside\s*\{[^}]*max-height:\s*none/s);
  });

  it('issues #1141/#1142 type scale is monotonic, numerics share one stack, state pairs meet 7:1 and badges carry a shape', () => {
    const tokensSource = readStaticFile('static/css/tokens.css');
    const componentsSource = readStaticFile('static/css/components.css');
    const dashboardSource = readStaticFile('static/css/dashboard.css');

    const scaleKeys = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'] as const;
    const scaleValues = scaleKeys.map((key) => {
      const match = tokensSource.match(new RegExp(`--font-size-${key}:\\s*([\\d.]+)rem`));
      expect(match, `--font-size-${key} must exist`).not.toBeNull();
      return Number(match![1]);
    });
    for (let i = 1; i < scaleValues.length; i += 1) {
      expect(scaleValues[i]).toBeGreaterThan(scaleValues[i - 1]);
    }

    expect(tokensSource).toContain('--font-numeric: var(--font-family-mono)');

    function hexToLinearChannel(hex: string): number {
      const normalized = hex.replace('#', '');
      const expanded =
        normalized.length === 3
          ? normalized
              .split('')
              .map((c) => c + c)
              .join('')
          : normalized;
      const value = Number.parseInt(expanded, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }

    function relativeLuminance(hex: string): number {
      const normalized = hex.replace('#', '');
      const expanded =
        normalized.length === 3
          ? normalized
              .split('')
              .map((c) => c + c)
              .join('')
          : normalized;
      const r = hexToLinearChannel(expanded.slice(0, 2));
      const g = hexToLinearChannel(expanded.slice(2, 4));
      const b = hexToLinearChannel(expanded.slice(4, 6));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(fgHex: string, bgHex: string): number {
      const l1 = relativeLuminance(fgHex);
      const l2 = relativeLuminance(bgHex);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    for (const state of ['ok', 'warn', 'crit', 'idle'] as const) {
      const bgMatch = tokensSource.match(
        new RegExp(`--color-state-${state}-bg:\\s*(#[0-9a-fA-F]{3,8})`),
      );
      const textMatch = tokensSource.match(
        new RegExp(`--color-state-${state}-text:\\s*(#[0-9a-fA-F]{3,8})`),
      );
      expect(bgMatch, `--color-state-${state}-bg must exist`).not.toBeNull();
      expect(textMatch, `--color-state-${state}-text must exist`).not.toBeNull();
      expect(contrastRatio(textMatch![1], bgMatch![1])).toBeGreaterThanOrEqual(7);
    }

    expect(tokensSource).toContain('--color-status-error-bg: var(--color-state-crit-bg)');
    expect(tokensSource).toContain('--color-status-error-text: var(--color-state-crit-text)');

    for (const source of [componentsSource, dashboardSource]) {
      for (const block of source.split('}')) {
        if (!block.includes('font-variant-numeric: tabular-nums')) continue;
        expect(block).toContain('font-family: var(--font-numeric)');
      }
    }

    expect(componentsSource).toContain('.m-badge--ok::before');
    expect(componentsSource).toContain('.m-badge--warn::before');
    expect(componentsSource).toContain('.m-badge--crit::before');
    expect(componentsSource).toContain('.m-badge--idle::before');

    const okBefore = componentsSource.match(/\.m-badge--ok::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const warnBefore = componentsSource.match(/\.m-badge--warn::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const critBefore = componentsSource.match(/\.m-badge--crit::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const idleBefore = componentsSource.match(/\.m-badge--idle::before\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(okBefore).toContain('border-radius: 50%');
    expect(warnBefore).toContain('border-radius: 0');
    expect(critBefore).toContain('clip-path: polygon(');
    expect(idleBefore).toContain('border:');
    expect(idleBefore).toContain('transparent');
    expect(okBefore).not.toEqual(warnBefore);
    expect(okBefore).not.toEqual(critBefore);
    expect(okBefore).not.toEqual(idleBefore);
    expect(warnBefore).not.toEqual(critBefore);
    expect(warnBefore).not.toEqual(idleBefore);
    expect(critBefore).not.toEqual(idleBefore);
  });

  it('issue #1143 m-stat is a KPI tile with numeric value, caller-chosen delta and an inline-svg sparkline', () => {
    const componentsSource = readStaticFile('static/css/components.css');
    const dashboardSource = readStaticFile('static/dashboard.html');
    const embeddingHealthSource = readStaticFile('static/js/embedding-map-fetch-status.js');
    const hexLiteral = /#[0-9a-fA-F]{3,8}\b/;

    function ruleBody(src: string, selector: string): string {
      const needle = `${selector} {`;
      const start = src.indexOf(needle);
      expect(start, `${selector} rule must exist`).toBeGreaterThanOrEqual(0);
      const open = start + needle.length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < src.length; i += 1) {
        const char = src[i];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      return src.slice(open + 1, end);
    }

    const statBody = ruleBody(componentsSource, '.m-stat');
    expect(statBody).toContain('var(--radius-lg)');
    expect(statBody).toContain('var(--color-bg-card)');
    expect(statBody).toContain('var(--color-border-light)');

    const labelBody = ruleBody(componentsSource, '.m-stat__label');
    expect(labelBody).toContain('var(--font-size-xs)');
    expect(labelBody).toContain('var(--color-text-muted)');

    const valueBody = ruleBody(componentsSource, '.m-stat__value');
    expect(valueBody).toContain('var(--font-size-3xl)');
    expect(valueBody).toContain('font-family: var(--font-numeric)');
    expect(valueBody).toContain('tabular-nums');
    expect(valueBody).toContain('var(--line-height-tight)');

    const deltaGoodBody = ruleBody(componentsSource, '.m-stat__delta--good');
    expect(deltaGoodBody).toContain('--color-state-ok-bg');
    expect(deltaGoodBody).toContain('--color-state-ok-text');

    const deltaBadBody = ruleBody(componentsSource, '.m-stat__delta--bad');
    expect(deltaBadBody).toContain('--color-state-crit-bg');
    expect(deltaBadBody).toContain('--color-state-crit-text');

    const sparklineBody = ruleBody(componentsSource, '.m-sparkline');
    expect(sparklineBody).toContain('height: 28px');
    expect(componentsSource).toContain('.m-sparkline polyline {');
    expect(componentsSource).toContain('.m-sparkline rect {');

    const statSelectors = [
      '.m-stat-grid',
      '.m-stat',
      '.m-stat__label',
      '.m-stat__value',
      '.m-stat__note',
      '.m-stat__delta',
      '.m-stat__delta--good',
      '.m-stat__delta--bad',
      '.m-sparkline',
    ];
    for (const selector of statSelectors) {
      const body = ruleBody(componentsSource, selector);
      expect(body, `${selector} must not use hex literals`).not.toMatch(hexLiteral);
    }

    expect(componentsSource).toContain('.m-metric__value {');

    expect(dashboardSource).toContain('id="em-health-summary" class="m-stat-grid"');
    expect(dashboardSource).toContain('id="em-health-problems" class="m-stat-grid"');
    expect(embeddingHealthSource).toContain("'m-stat__value'");
    expect(embeddingHealthSource).toContain("'m-stat__note'");
    expect(embeddingHealthSource).not.toContain("'m-metric'");
  });

  it('issue #1144 nav rail keeps tab semantics, holds the session chip and falls back to a horizontal bar on mobile', () => {
    const html = readStaticFile('static/dashboard.html');
    const componentsCss = readStaticFile('static/css/components.css');
    const dashboardCss = readStaticFile('static/css/dashboard.css');
    const tabsJs = readStaticFile('static/js/dashboard-tabs.js');

    function ruleBody(src: string, selector: string): string {
      const needle = `${selector} {`;
      const start = src.indexOf(needle);
      expect(start, `${selector} rule must exist`).toBeGreaterThanOrEqual(0);
      const open = start + needle.length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < src.length; i += 1) {
        const char = src[i];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      return src.slice(open + 1, end);
    }

    expect(html).toContain('<nav class="m-nav-rail"');
    expect(html).toContain('role="tablist" aria-orientation="vertical"');

    const navIdx = html.indexOf('<nav class="m-nav-rail"');
    const tablistIdx = html.indexOf('role="tablist"');
    const sessionIdx = html.indexOf('id="dashboard-auth-session" class="m-session-chip"');
    const navCloseIdx = html.indexOf('</nav>', navIdx);
    expect(navIdx).toBeLessThan(tablistIdx);
    expect(tablistIdx).toBeLessThan(sessionIdx);
    expect(sessionIdx).toBeLessThan(navCloseIdx);

    const headerCloseIdx = html.indexOf('</header>');
    expect(html.indexOf('id="dashboard-auth-session"')).toBeGreaterThan(headerCloseIdx);

    const tabpanelMatches = html.match(/role="tabpanel"[^>]*aria-labelledby="(dashboard-tab-[a-z-]+)"/g) ?? [];
    expect(tabpanelMatches).toHaveLength(9);
    for (const match of tabpanelMatches) {
      const idMatch = match.match(/aria-labelledby="(dashboard-tab-[a-z-]+)"/);
      expect(idMatch).not.toBeNull();
      const tabId = idMatch![1];
      expect(html).toMatch(new RegExp(`id="${tabId}"[^>]*role="tab"`));
    }

    expect(html).not.toContain('aria-current');

    const navRailBody = ruleBody(componentsCss, '.m-nav-rail');
    expect(navRailBody).toContain('width: 232px');

    const activeBody = ruleBody(componentsCss, '.m-tab-btn.active');
    expect(activeBody).toContain('var(--color-accent-weak)');
    expect(activeBody).toContain('var(--color-brand-primary)');
    expect(activeBody).not.toContain('border-left');

    const hoverBody = ruleBody(componentsCss, '.m-tab-btn:hover');
    expect(hoverBody).toContain('var(--color-bg-hover)');

    expect(componentsCss).toContain('.m-session-chip {');

    expect(dashboardCss).toContain('@media (min-width: 80rem)');
    expect(dashboardCss).toContain('grid-template-columns: 232px minmax(0, 1fr)');
    const mobileRailAt = dashboardCss.indexOf('@media (max-width: 79.99rem) {\n  .m-nav-rail {');
    const mobileTabBarAt = dashboardCss.indexOf('.m-nav-rail .m-tab-bar {');
    expect(mobileRailAt).toBeGreaterThanOrEqual(0);
    expect(mobileTabBarAt).toBeGreaterThan(mobileRailAt);
    expect(ruleBody(dashboardCss.slice(mobileRailAt), '.m-nav-rail .m-tab-bar')).toContain('overflow-x: auto');

    const phoneRailAt = dashboardCss.indexOf('@media (max-width: 30rem) {\n  .m-nav-rail {');
    expect(phoneRailAt).toBeGreaterThan(mobileRailAt);
    expect(ruleBody(dashboardCss.slice(phoneRailAt), '.m-nav-rail')).toContain('flex-wrap: wrap');
    expect(ruleBody(dashboardCss.slice(phoneRailAt), '.m-session-chip')).toContain('flex: 1 1 100%');

    expect(dashboardCss).toContain('.dashboard-auth-panel:has(.dashboard-auth-message:empty)');
    expect(dashboardCss).not.toContain('.dashboard-auth-session');

    expect(tabsJs).toContain("'ArrowDown'");
    expect(tabsJs).toContain("'ArrowUp'");

    expect(componentsCss).toContain('.m-tab-btn.active {');
    expect(dashboardCss).not.toContain('.m-tab-btn.active {');
  });

  it('issue #1145 ops overview styles use tokens only', () => {
    const dashboardCss = readStaticFile('static/css/dashboard.css');
    const marker = '/* Ops overview tab (#1145) */';
    const nextMarker = '/* Ops status rows (#1146) */';
    const start = dashboardCss.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = dashboardCss.indexOf(nextMarker, start);
    const section =
      end >= 0 ? dashboardCss.slice(start + marker.length, end) : dashboardCss.slice(start + marker.length);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('issue #1146 ops status row styles use tokens only', () => {
    const dashboardCss = readStaticFile('static/css/dashboard.css');
    const marker = '/* Ops status rows (#1146) */';
    const start = dashboardCss.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const section = dashboardCss.slice(start + marker.length);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).toContain('.ops-row__trend .m-sparkline');
    expect(section).toContain('width: 90px');
    expect(section).toContain('height: 20px');
  });

  it('issue #1147 every @media uses one of the three --bp-* token values', () => {
    const tokensSource = readStaticFile('static/css/tokens.css');
    const bpMatches = [...tokensSource.matchAll(/--bp-([a-z]+):\s*([\d.]+)rem;/g)];
    expect(bpMatches.map((m) => m[1])).toEqual(['lg', 'md', 'sm']);
    const bps = bpMatches.map((m) => Number(m[2]));
    expect(bps).toEqual([80, 48, 30]);

    const cssFiles = ['static/css/tokens.css', 'static/css/components.css', 'static/css/dashboard.css'];
    const used = new Set<number>();
    let mediaCount = 0;
    for (const file of cssFiles) {
      const source = readStaticFile(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of source.matchAll(/@media\s*([^{]+)\{/g)) {
        mediaCount += 1;
        const condition = match[1].trim();
        const parsed = condition.match(/^\((min|max)-width: ([\d.]+)rem\)$/);
        expect(parsed, `${file}: unexpected @media ${condition}`).not.toBeNull();
        const value = Number(parsed![2]);
        const base = bps.includes(value) ? value : bps.find((bp) => Math.abs(bp - 0.01 - value) < 1e-9);
        expect(base, `${file}: @media ${condition} is not a --bp-* value`).toBeDefined();
        if (parsed![1] === 'min') expect(bps).toContain(value);
        used.add(base!);
      }
    }
    expect(mediaCount).toBeGreaterThanOrEqual(12);
    expect([...used].sort((a, b) => b - a)).toEqual([80, 48, 30]);
  });

  it('issue #1147 phone nav: menu button controls the tablist and chips map to nav groups', () => {
    const html = readStaticFile('static/dashboard.html');
    const componentsCss = readStaticFile('static/css/components.css');
    const dashboardCss = readStaticFile('static/css/dashboard.css');
    const tabsJs = readStaticFile('static/js/dashboard-tabs.js');

    expect(html).toMatch(/<button type="button" id="dashboard-nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="dashboard-tablist"/);
    expect(html).toContain('<div id="dashboard-tablist" class="m-tab-bar" role="tablist"');

    const navIdx = html.indexOf('<nav class="m-nav-rail"');
    const compactIdx = html.indexOf('<div class="m-nav-compact">');
    const tablistIdx = html.indexOf('role="tablist"');
    expect(navIdx).toBeLessThan(compactIdx);
    expect(compactIdx).toBeLessThan(tablistIdx);

    const chipKeys = [...html.matchAll(/class="m-nav-chip[^"]*" data-nav-group="([a-z]+)"/g)].map((m) => m[1]);
    const groupKeys = [...html.matchAll(/class="m-nav-group[^"]*" role="presentation" data-nav-group="([a-z]+)"/g)].map((m) => m[1]);
    expect(chipKeys).toEqual(['spatial', 'ops', 'learn']);
    expect(groupKeys).toEqual(chipKeys);

    expect(componentsCss).toMatch(/\.m-nav-compact \{\s*display: none;\s*\}/);
    expect(componentsCss).toMatch(/\.m-nav-compact__menu \{[^}]*width: 44px;[^}]*height: 44px;/s);
    expect(componentsCss).toMatch(/\.m-nav-chip \{[^}]*min-height: 44px;/s);

    const phoneRailAt = dashboardCss.indexOf('@media (max-width: 30rem) {\n  .m-nav-rail {');
    const phoneBlock = extractAtMediaBlock(dashboardCss.slice(phoneRailAt), '(max-width: 30rem)');
    expect(phoneBlock).toMatch(/\.m-nav-compact \{[^}]*display: flex;/s);
    expect(phoneBlock).toMatch(/\.m-nav-rail:not\(\.is-expanded\) \.m-tab-bar \{\s*display: none;/);
    expect(phoneBlock).toMatch(/\.m-nav-rail \.m-tab-btn \{[^}]*min-height: 44px;/s);

    expect(tabsJs).toContain("navToggle.setAttribute('aria-expanded'");
    expect(tabsJs).toContain("chip.setAttribute('aria-pressed'");
    expect(tabsJs).toContain("e.key === 'Escape'");
  });
});
