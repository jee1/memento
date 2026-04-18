import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
}

function serverInfoPath(configDir: string): string {
  return join(configDir, 'server.json');
}

export async function writeServerInfo(configDir: string, port: number): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const info: ServerInfo = { port, pid: process.pid, startedAt: new Date().toISOString() };
  await writeFile(serverInfoPath(configDir), JSON.stringify(info, null, 2), 'utf-8');
}

export async function readServerInfo(configDir: string): Promise<ServerInfo | null> {
  try {
    const raw = await readFile(serverInfoPath(configDir), 'utf-8');
    return JSON.parse(raw) as ServerInfo;
  } catch {
    return null;
  }
}

export async function deleteServerInfo(configDir: string): Promise<void> {
  try {
    await unlink(serverInfoPath(configDir));
  } catch {
    // ignore if file doesn't exist
  }
}

export async function isServerAlive(info: ServerInfo): Promise<boolean> {
  // Step 1: PID existence check
  try {
    process.kill(info.pid, 0);
  } catch {
    return false;
  }
  // Step 2: HTTP /health check (prevents PID reuse false positives)
  try {
    const res = await fetch(`http://localhost:${info.port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function callToolViaHttp(
  port: number,
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`http://localhost:${port}/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(
      (typeof body.message === 'string' ? body.message : null) ??
      `HTTP ${res.status}: Tool ${toolName} failed`,
    );
  }

  return body.result;
}
