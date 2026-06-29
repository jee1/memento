import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readStaticFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
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

  it('token readers fail in a bounded way when a required token is missing', () => {
    // readAnchorMapToken lives in the shared module after the god-function split (#596)
    const anchorMapSource = readStaticFile('static/js/anchor-map-shared.js');
    const graphSource = readStaticFile('static/js/graph.js');

    expect(anchorMapSource).toMatch(/function readAnchorMapToken\(name, fallback = ''\)/);
    expect(anchorMapSource).toMatch(/throw new Error\(`Missing CSS token: \$\{name\}`\);/);
    expect(graphSource).toMatch(/function readGraphToken\(name, fallback = ''\)/);
    expect(graphSource).toMatch(/throw new Error\(`Missing CSS token: \$\{name\}`\);/);
  });

  it('graph.js reads colors from tokens instead of hardcoded hex or inline styles', () => {
    const source = readStaticFile('static/js/graph.js');

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
});
