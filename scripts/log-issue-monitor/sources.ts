import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function readDockerLogs(containerName: string, since?: string): Promise<string[]> {
  const args = ['logs'];
  if (since) args.push('--since', since);
  args.push(containerName);

  const { stdout, stderr } = await execFileAsync('docker', args, { maxBuffer: 10 * 1024 * 1024 });
  return `${stdout}\n${stderr}`
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export async function readJsonlFiles(logsRoot: string): Promise<string[]> {
  const directories = [join(logsRoot, 'diagnostics'), join(logsRoot, 'docker-diagnostics')];
  const records: string[] = [];

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

      records.push(
        ...(await readFile(path, 'utf8'))
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
      );
    }
  }

  return records;
}

