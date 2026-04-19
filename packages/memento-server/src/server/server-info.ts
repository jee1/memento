import { homedir } from 'os';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
}

type ConfigDirResolutionOptions = {
  env?: NodeJS.ProcessEnv;
  homedirPath?: string;
};

function serverInfoPath(configDir: string): string {
  return join(configDir, 'server.json');
}

export function resolveServerInfoConfigDir(
  options: ConfigDirResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const explicit = env.MEMENTO_CONFIG_DIR?.trim();
  if (explicit) {
    return explicit;
  }

  // Docker 이미지는 비루트 사용자로 실행되므로 HOME 기반 경로가 비어 있거나
  // 부모 디렉터리가 생성되지 않은 경우를 대비해 앱 작업 디렉터리 하위를 기본값으로 사용한다.
  if (env.DOCKER === 'true') {
    return '/app/.memento';
  }

  return join(options.homedirPath ?? process.env.HOME ?? homedir(), '.memento');
}

export async function writeServerInfo(configDir: string, port: number): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(configDir, { recursive: true });
  const info: ServerInfo = { port, pid: process.pid, startedAt: new Date().toISOString() };
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(serverInfoPath(configDir), JSON.stringify(info, null, 2), 'utf-8');
}

export async function readServerInfo(configDir: string): Promise<ServerInfo | null> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await readFile(serverInfoPath(configDir), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.port !== 'number' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }
    return parsed as unknown as ServerInfo;
  } catch {
    return null;
  }
}

export async function deleteServerInfo(configDir: string): Promise<void> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
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
    const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
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
