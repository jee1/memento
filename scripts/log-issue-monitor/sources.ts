import { execFile, type ExecFileOptions } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { JsonlFileCursors } from './types.js';

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
}

function cursorKey(logsRoot: string, filePath: string): string {
  return relative(logsRoot, filePath);
}

async function readIncrementalJsonlLines(
  filePath: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (offset > size) {
      offset = 0;
    }

    const length = size - offset;
    if (length <= 0) {
      return { lines: [], nextOffset: offset };
    }

    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead);

    let start = 0;
    if (offset > 0) {
      const priorByte = Buffer.alloc(1);
      await handle.read(priorByte, 0, 1, offset - 1);
      if (priorByte[0] !== 0x0a) {
        const firstNewline = chunk.indexOf(0x0a);
        if (firstNewline === -1) {
          return { lines: [], nextOffset: offset };
        }
        start = firstNewline + 1;
      }
    }

    if (start >= chunk.length) {
      return { lines: [], nextOffset: size };
    }

    let end = chunk.length;
    if (chunk[chunk.length - 1] !== 0x0a) {
      const lastNewline = chunk.lastIndexOf(0x0a);
      if (lastNewline < start) {
        return { lines: [], nextOffset: offset };
      }
      end = lastNewline + 1;
    }

    const lines = splitJsonlLines(chunk.subarray(start, end).toString('utf8'));
    return { lines, nextOffset: offset + end };
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
    await runDocker(['inspect', '-f', '{{.Id}}', preferred], execImpl);
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
      const { stdout: nameOut } = await runDocker(['inspect', '-f', '{{.Name}}', id], execImpl);
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
          `Compose often names containers like "<project>_memento-mcp-server_1"; set the env to that name, or use docker-compose.diagnostics.yml (container_name).\n`,
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
): Promise<ReadJsonlFilesResult> {
  const diagnosticsDir = join(logsRoot, 'diagnostics');
  const dockerDiagnosticsDir = join(logsRoot, 'docker-diagnostics');
  const directories = [diagnosticsDir, dockerDiagnosticsDir];
  const records: string[] = [];
  const nextCursors: JsonlFileCursors = { ...cursors };

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
      const { lines, nextOffset } = await readIncrementalJsonlLines(path, offset);
      nextCursors[key] = nextOffset;

      if (lines.length === 0) continue;

      if (directory === dockerDiagnosticsDir && file === DOCKER_INSPECT_JSONL) {
        records.push(lines[lines.length - 1]!);
      } else {
        records.push(...lines);
      }
    }
  }

  return { lines: records, cursors: nextCursors };
}
