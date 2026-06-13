import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd());
const staticRoot = join(root, 'static');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function resolveAsset(url) {
  if (url === '/dashboard' || url === '/') {
    return join(staticRoot, 'dashboard.html');
  }
  if (!url.startsWith('/static/')) {
    return null;
  }
  const relative = normalize(url.slice('/static/'.length)).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(staticRoot, relative);
  return candidate.startsWith(staticRoot) ? candidate : null;
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const filePath = resolveAsset(pathname);
  if (!filePath) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    if (!statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
});

server.listen(4173, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
