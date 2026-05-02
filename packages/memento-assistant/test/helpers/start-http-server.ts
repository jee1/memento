import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTTP_BIN = resolve(__dirname, './http-server-runner.js');

export interface TestServer {
  url: string;
  apiKey: string;
  stop(): Promise<void>;
}

export async function startTestHttpServer(): Promise<TestServer> {
  const port = await findFreePort();
  const apiKey = 'test-key-123';

  const proc = spawn('node', [HTTP_BIN], {
    env: {
      ...process.env,
      MCP_SERVER_PORT: String(port),
      DB_PATH: ':memory:',
      ADMIN_API_KEY: apiKey,
      MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for server to be ready by polling /health
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(`${url}/health`, 15_000);

  return {
    url,
    apiKey,
    stop: () => new Promise<void>((resolve) => {
      proc.kill('SIGTERM');
      proc.on('exit', () => resolve());
      setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5000);
    }),
  };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}
