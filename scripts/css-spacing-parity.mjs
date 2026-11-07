#!/usr/bin/env node
/**
 * #1660: capture/compare computed spacing-related styles for dashboard selectors.
 * Usage:
 *   node scripts/css-spacing-parity.mjs capture --out .local/css-parity-1660/before.json
 *   node scripts/css-spacing-parity.mjs capture --out .local/css-parity-1660/after.json
 *   node scripts/css-spacing-parity.mjs diff --before ... --after ...
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
  '.ops-strip',
  '.ops-row',
  '.ops-row__trend .m-sparkline',
  '.ops-status-layout',
  '.ops-status-header',
  '.ops-status-card',
  '.ops-status-title',
  '.m-tab-btn',
  '.m-metric',
  '.m-table',
  '.review-candidates-layout',
  '.rc-health',
];

const PROPS = [
  'marginTop','marginRight','marginBottom','marginLeft',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'gap','rowGap','columnGap',
  'borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius',
  'width','height','minWidth','minHeight','maxWidth','maxHeight',
  'gridTemplateColumns','gridTemplateRows',
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

async function capture(outPath) {
  const { server, port } = await startStaticServer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(`http://127.0.0.1:${port}/dashboard.html`, { waitUntil: 'domcontentloaded' });
    // Force-show ops-status panel content in DOM (tabs may hide via CSS)
    await page.evaluate(() => {
      document.querySelectorAll('.m-panel').forEach((el) => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
      });
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
      // Also sample first ops-row if present
      return out;
    }, { selectors: SELECTORS, props: PROPS });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ viewport: { width: 1440, height: 1100 }, snapshot }, null, 2));
    console.log(`wrote ${outPath}`);
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
  for (const sel of keys) {
    const b = before.snapshot[sel];
    const a = after.snapshot[sel];
    if (b == null && a == null) continue;
    if (b == null || a == null) {
      diffs.push({ sel, reason: 'missing', before: b, after: a });
      continue;
    }
    for (const p of PROPS) {
      if (b[p] !== a[p]) diffs.push({ sel, prop: p, before: b[p], after: a[p] });
    }
  }
  if (diffs.length) {
    console.error(`PARITY FAIL: ${diffs.length} diffs`);
    console.error(JSON.stringify(diffs.slice(0, 50), null, 2));
    process.exit(1);
  }
  console.log(`PARITY OK: ${keys.size} selectors, ${PROPS.length} props each`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'capture') {
  if (!args.out) throw new Error('--out required');
  await capture(join(root, args.out));
} else if (cmd === 'diff') {
  await diff(join(root, args.before), join(root, args.after));
} else {
  console.error('usage: capture|diff');
  process.exit(2);
}
