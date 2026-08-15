#!/usr/bin/env node
/**
 * `npm pack`이 prepack 이후 실패하면 postpack이 실행되지 않아 node_modules/@memento/{core,agent-integration}이
 * 복사본으로 남을 수 있다. prepack → pack → 복구를 한 프로세스에서 묶어 항상 워크스페이스 링크를 되살린다.
 *
 * 사용: npm run pack:tarball -- [npm pack에 넘길 인자]
 * 내부적으로 `npm pack --ignore-scripts`를 쓰므로 lifecycle prepack/postpack은 이 스크립트가 직접 호출한다.
 */
import { execSync, spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
/** Windows: spawn('npm')는 실행 파일이 아니라 npm.cmd를 써야 한다. */
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execSync('node scripts/prepack-bundle-core.js', { cwd: root, stdio: 'inherit' });
const extra = process.argv.slice(2);
/** process.exit()은 finally를 실행하지 않으므로, 종료 코드만 저장한 뒤 복구 스크립트 실행 후 한 번만 exit */
let packExitCode = 1;
try {
  const r = spawnSync(npmCli, ['pack', '--ignore-scripts', ...extra], { cwd: root, stdio: 'inherit' });
  if (r.error) {
    throw r.error;
  }
  packExitCode = r.status ?? 1;
} finally {
  execSync('node scripts/postpack-restore-workspace.js', { cwd: root, stdio: 'inherit' });
}
process.exit(packExitCode);
