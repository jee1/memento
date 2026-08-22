import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFile, type ExecFileOptions } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { JsonlFileCursors, JsonlReadSkip } from './types.js';

const execOpts: ExecFileOptions = { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 };

let lastNoContainerLogAt = 0;
const NO_CONTAINER_LOG_INTERVAL_MS = 300_000;

/** Append-only `docker inspect` JSONL: only the last line reflects current container state. */
const DOCKER_INSPECT_JSONL = 'docker-inspect.jsonl';

export function splitJsonlLines(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export type ExecFileLike = typeof execFile;

export interface ReadJsonlFilesResult {
  lines: string[];
  cursors: JsonlFileCursors;
  skips: JsonlReadSkip[];
}

function cursorKey(logsRoot: string, filePath: string): string {
  return relative(logsRoot, filePath);
}

async function findLastNewlineBefore(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<number> {
  const chunkSize = 4096;
  let position = size;
  while (position > 0) {
    const readSize = Math.min(chunkSize, position);
    position -= readSize;
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, position);
    for (let index = readSize - 1; index >= 0; index -= 1) {
      if (buffer[index] === 0x0a) {
        return position + index;
      }
    }
  }
  return -1;
}

async function readStreamLines(
  filePath: string,
  offset: number,
  length: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  if (length <= 0) {
    return { lines: [], nextOffset: offset };
  }

  const end = offset + length - 1;
  let droppedPartialFirstLine = false;
  if (offset > 0) {
    const handle = await open(filePath, 'r');
    try {
      const priorByte = Buffer.alloc(1);
      await handle.read(priorByte, 0, 1, offset - 1);
      droppedPartialFirstLine = priorByte[0] !== 0x0a;
    } finally {
      await handle.close();
    }
  }

  const lines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { start: offset, end });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    reader.on('line', line => {
      if (droppedPartialFirstLine) {
        droppedPartialFirstLine = false;
        return;
      }
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    });
    reader.on('close', resolve);
    reader.on('error', reject);
    stream.on('error', reject);
  });

  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size > offset && lines.length > 0) {
      const tail = Buffer.alloc(1);
      await handle.read(tail, 0, 1, size - 1);
      if (tail[0] !== 0x0a) {
        lines.pop();
        const lastNewline = await findLastNewlineBefore(handle, size);
        return { lines, nextOffset: lastNewline >= offset ? lastNewline + 1 : offset };
      }
    }
    return { lines, nextOffset: size };
  } finally {
    await handle.close();
  }
}

async function readIncrementalJsonlLines(
  filePath: string,
  offset: number,
  maxReadBytes: number,
): Promise<{ lines: string[]; nextOffset: number; skipped?: JsonlReadSkip }> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (offset > size) {
      offset = 0;
    }

    const unread = size - offset;
    if (unread <= 0) {
      return { lines: [], nextOffset: offset };
    }

    if (maxReadBytes > 0 && unread > maxReadBytes) {
      process.stderr.write(
        `log-issue-monitor: skipping oversized JSONL ${filePath} (${unread} unread bytes > ${maxReadBytes}); ` +
          'truncate or rotate the file — see docs/operations/en/log-issue-monitor.md\n',
      );
      return {
        lines: [],
        nextOffset: size,
        skipped: { path: filePath, unreadBytes: unread, maxReadBytes },
      };
    }

    return readStreamLines(filePath, offset, unread);
  } finally {
    await handle.close();
  }
}

function runDocker(
  args: readonly string[],
  execImpl: ExecFileLike,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execImpl('docker', args as string[], execOpts, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Resolves a user-configured container name to an ID or name that `docker logs` accepts.
 * Compose default names look like `{project}_memento-mcp-server_1` (underscores) or legacy
 * `{project}-memento-mcp-server-1` (hyphens); `container_name: memento-mcp-server` matches directly.
 */
export async function resolveDockerLogsRef(
  preferred: string,
  execImpl: ExecFileLike = execFile,
): Promise<string | undefined> {
  try {
    // Restrict to containers: bare `docker inspect <name>` also matches images (e.g. memento-mcp-server:latest).
    await runDocker(['inspect', '--type', 'container', '-f', '{{.Id}}', preferred], execImpl);
    return preferred;
  } catch {
    // fall through — e.g. Compose-assigned container name
  }

  const listAll = await runDocker(['ps', '-aq', '-f', `name=${preferred}`], execImpl);
  const ids = listAll.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return undefined;
  }
  if (ids.length === 1) {
    return ids[0];
  }

  for (const id of ids) {
    try {
      const { stdout: nameOut } = await runDocker(
        ['inspect', '--type', 'container', '-f', '{{.Name}}', id],
        execImpl,
      );
      const containerName = nameOut.trim().replace(/^\//, '');
      if (containerName === preferred) {
        return id;
      }
    } catch {
      continue;
    }
  }

  const running = await runDocker(['ps', '-q', '-f', `name=${preferred}`], execImpl);
  const runningIds = running.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (runningIds.length >= 1) {
    return runningIds[0];
  }

  return ids[0];
}

export async function readDockerLogs(
  containerName: string,
  since?: string,
  execImpl: ExecFileLike = execFile,
): Promise<string[]> {
  const ref = await resolveDockerLogsRef(containerName, execImpl);
  if (!ref) {
    const now = Date.now();
    if (now - lastNoContainerLogAt >= NO_CONTAINER_LOG_INTERVAL_MS) {
      lastNoContainerLogAt = now;
      process.stderr.write(
        `log-issue-monitor: no running or stopped container matched LOG_ISSUE_MONITOR_CONTAINER_NAME=${JSON.stringify(containerName)}. ` +
          `Compose often names containers like "<project>_memento-mcp-server_1"; set the env to that name, or use docker/docker-compose.diagnostics.yml (container_name).\n`,
      );
    }
    return [];
  }

  const args = ['logs'];
  if (since) args.push('--since', since);
  args.push(ref);

  const { stdout, stderr } = await runDocker(args, execImpl);
  return `${stdout}\n${stderr}`
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export async function readJsonlFiles(
  logsRoot: string,
  cursors: JsonlFileCursors = {},
  maxReadBytes = 0,
): Promise<ReadJsonlFilesResult> {
  const diagnosticsDir = join(logsRoot, 'diagnostics');
  const dockerDiagnosticsDir = join(logsRoot, 'docker-diagnostics');
  const directories = [diagnosticsDir, dockerDiagnosticsDir];
  const records: string[] = [];
  const nextCursors: JsonlFileCursors = { ...cursors };
  const skips: JsonlReadSkip[] = [];

  for (const directory of directories) {
    let files: string[] = [];
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }

    for (const file of files.filter(name => name.endsWith('.jsonl'))) {
      const path = join(directory, file);
      const info = await stat(path);
      if (!info.isFile()) continue;

      const key = cursorKey(logsRoot, path);
      const offset = cursors[key] ?? 0;
      const { lines, nextOffset, skipped } = await readIncrementalJsonlLines(path, offset, maxReadBytes);
      nextCursors[key] = nextOffset;
      if (skipped) {
        skips.push(skipped);
        continue;
      }

      if (lines.length === 0) continue;

      if (directory === dockerDiagnosticsDir && file === DOCKER_INSPECT_JSONL) {
        records.push(lines[lines.length - 1]!);
      } else {
        for (const line of lines) {
          records.push(line);
        }
      }
    }
  }

  return { lines: records, cursors: nextCursors, skips };
}
