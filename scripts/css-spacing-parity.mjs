#!/usr/bin/env node
/**
 * #1660: capture/compare computed spacing-related styles for dashboard selectors.
 * Usage:
 *   node scripts/css-spacing-parity.mjs capture --out .local/css-parity-1660/after-1440.json
 *   node scripts/css-spacing-parity.mjs capture --out .local/css-parity-1660/after-390.json --viewport 390x844
 *   node scripts/css-spacing-parity.mjs diff --before ... --after ...
 *
 * Chrome: PLAYWRIGHT_CHROME / CHROME_PATH, else Playwright bundled Chromium.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticRoot = join(root, 'static');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SELECTORS = [
  '.m-header',
  '.m-nav-rail',
  '.m-nav-compact__menu',
  '.m-nav-chip',
  '.m-button',
  '.m-about',
  '.m-badge',
  '.m-toolbar',
  '.ops-row',
  '.ops-status-layout',
  '.ops-status-header',
  '.ops-status-card',
  '.ops-status-title',
  '.m-tab-btn',
  '.m-metric',
  '.m-table',
  '.review-candidates-layout',
  '.rc-health',
  '.rc-filter-field',
  '.jobs-schedule__desc',
];

const PROPS = [
  'marginTop','marginRight','marginBottom','marginLeft',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'gap','rowGap','columnGap',
  'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
  'width','height','minWidth','minHeight','maxWidth','maxHeight',
  'gridTemplateColumns','gridTemplateRows',
];

const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 1100 },
  { width: 390, height: 844 },
];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    } else out._.push(a);
  }
  return out;
}

function parseViewport(raw) {
  if (!raw) return DEFAULT_VIEWPORTS[0];
  const m = String(raw).match(/^(\d+)x(\d+)$/i);
  if (!m) throw new Error(`bad --viewport ${raw} (want WxH)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function resolveChromePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // undefined → Playwright bundled Chromium
  return undefined;
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = url === '/' ? '/dashboard.html' : url;
      if (rel.startsWith('/static/')) rel = rel.slice('/static'.length);
      const filePath = join(staticRoot, rel.replace(/^\//, ''));
      if (!filePath.startsWith(staticRoot)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      try {
        const body = readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('missing');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function capture(outPath, viewport) {
  const { server, port } = await startStaticServer();
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  };
  const chromePath = resolveChromePath();
  if (chromePath) launchOpts.executablePath = chromePath;
  const browser = await chromium.launch(launchOpts);
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(`http://127.0.0.1:${port}/dashboard.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.querySelectorAll('.m-panel').forEach((el) => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
      });
      // Sparkline / metric / rc-health exist only after JS fill — seed for parity.
      const trend = document.querySelector('.ops-row__trend');
      if (trend && !trend.querySelector('.m-sparkline')) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'm-sparkline');
        svg.setAttribute('viewBox', '0 0 90 20');
        trend.appendChild(svg);
      }
      const healthLive = document.getElementById('rc-health-live');
      if (healthLive) {
        healthLive.classList.remove('hidden');
        if (!healthLive.querySelector('.m-metric')) {
          healthLive.innerHTML =
            '<div class="m-metric"><div class="m-metric__label">parity</div>' +
            '<div class="m-metric__value">1</div></div>';
        }
        if (!healthLive.classList.contains('rc-health')) {
          healthLive.classList.add('rc-health');
        }
      }
      const jobsPanel = document.getElementById('jobs-panel') || document.querySelector('[data-panel="jobs"]');
      let desc = document.querySelector('.jobs-schedule__desc');
      if (!desc) {
        const host = jobsPanel || document.body;
        const wrap = document.createElement('div');
        wrap.innerHTML =
          '<table class="jobs-schedule"><tbody><tr><td>' +
          '<div class="jobs-schedule__name">parity</div>' +
          '<div class="jobs-schedule__desc">seed</div></td></tr></tbody></table>';
        host.appendChild(wrap);
        desc = wrap.querySelector('.jobs-schedule__desc');
      }
      if (!document.querySelector('.rc-filter-field')) {
        const filters = document.querySelector('.rc-filters') || document.body;
        const field = document.createElement('label');
        field.className = 'rc-filter-field';
        field.textContent = 'parity';
        filters.appendChild(field);
      }
    });
    const snapshot = await page.evaluate(({ selectors, props }) => {
      const pick = (cs) => {
        const o = {};
        for (const p of props) o[p] = cs[p];
        return o;
      };
      const out = {};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) { out[sel] = null; continue; }
        out[sel] = pick(getComputedStyle(el));
      }
      return out;
    }, { selectors: SELECTORS, props: PROPS });
    const missing = SELECTORS.filter((sel) => snapshot[sel] == null);
    if (missing.length) {
      console.error(`PARITY CAPTURE WARN: null selectors: ${missing.join(', ')}`);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ viewport, snapshot }, null, 2));
    console.log(`wrote ${outPath} (${viewport.width}x${viewport.height}, ${SELECTORS.length - missing.length}/${SELECTORS.length} hit)`);
  } finally {
    await browser.close();
    server.close();
  }
}

function diff(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const diffs = [];
  const keys = new Set([...Object.keys(before.snapshot), ...Object.keys(after.snapshot)]);
  let hit = 0;
  let miss = 0;
  for (const sel of keys) {
    const b = before.snapshot[sel];
    const a = after.snapshot[sel];
    if (b == null && a == null) { miss += 1; continue; }
    if (b == null || a == null) {
      diffs.push({ sel, reason: 'missing', before: b, after: a });
      miss += 1;
      continue;
    }
    hit += 1;
    for (const p of PROPS) {
      if (b[p] !== a[p]) diffs.push({ sel, prop: p, before: b[p], after: a[p] });
    }
  }
  if (diffs.length) {
    console.error(`PARITY FAIL: ${diffs.length} diffs (hit ${hit}, miss ${miss})`);
    console.error(JSON.stringify(diffs.slice(0, 50), null, 2));
    process.exit(1);
  }
  console.log(`PARITY OK: ${hit}/${keys.size} selectors hit, ${PROPS.length} props each` +
    (before.viewport ? ` @${before.viewport.width}x${before.viewport.height}` : ''));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'capture') {
  if (!args.out) throw new Error('--out required');
  await capture(join(root, args.out), parseViewport(args.viewport));
} else if (cmd === 'diff') {
  await diff(join(root, args.before), join(root, args.after));
} else {
  console.error('usage: capture|diff [--viewport WxH] [--out|--before|--after path]');
  process.exit(2);
}
