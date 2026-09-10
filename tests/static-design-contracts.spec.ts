import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readStaticFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
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

    expect(renderSource).toContain('showEmptyMapMessage(');
    expect(renderSource).toMatch(/\.attr\('class', 'map-empty-message'\)/);
    expect(cssSource).toContain('.map-empty-message');
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
});
