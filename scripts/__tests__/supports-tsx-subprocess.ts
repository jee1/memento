import { spawnSync } from 'node:child_process';

let cachedResult: boolean | undefined;

export function supportsTsxSubprocess(): boolean {
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const probe = spawnSync(
    process.execPath,
    ['./node_modules/tsx/dist/cli.mjs', '--version'],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe'
    }
  );

  cachedResult = !probe.error && probe.status === 0;
  return cachedResult;
}
