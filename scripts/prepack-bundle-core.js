#!/usr/bin/env node
/**
 * npm pack / npm publish 시 bundledDependencies에 @memento/core가 실려야 하는데,
 * 워크스페이스는 보통 node_modules/@memento/core → packages/memento-core 심볼릭 링크라
 * npm이 tarball에 실어 넣지 않는다. `npm pack --dry-run`의 bundled files: 0 표시는 신뢰하지 말고
 * `npm run verify-pack-bundle`로 실제 .tgz 안에 package/node_modules/@memento/core/dist/index.js 가 있는지 확인한다.
 * 패킹 직전에 실제 디렉터리로 복사해 tarball에 core가 포함되도록 한다.
 * @see https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundleddependencies
 *
 * pack 단계가 prepack 직후 실패하면 postpack이 돌지 않아 node_modules/@memento/core가 복사본으로 남을 수 있다.
 * 다음 prepack 시작 시 워크스페이스 링크를 먼저 복구한 뒤 다시 복사해, 이전 실패로 남은 복사본을 정리한다.
 * 권장: `npm run pack:tarball` 또는 실패 직후 `npm run restore-workspace`.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const coreSrc = join(root, 'packages/memento-core');
const dest = join(root, 'node_modules/@memento/core');

try {
  execSync('node scripts/postpack-restore-workspace.js', { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.error('[prepack-bundle-core] 워크스페이스 링크 복구(시작 시) 실패:', e);
  process.exit(1);
}

if (!existsSync(join(coreSrc, 'package.json'))) {
  console.error('[prepack-bundle-core] packages/memento-core not found');
  process.exit(1);
}

if (!existsSync(join(coreSrc, 'dist/index.js'))) {
  console.error('[prepack-bundle-core] dist missing; running npm run build -w @memento/core');
  execSync('npm run build -w @memento/core', { cwd: root, stdio: 'inherit' });
}

const rootMcpBin = join(root, 'dist/server/index.js');
const rootHttpBin = join(root, 'dist/server/http-server.js');
if (!existsSync(rootMcpBin) || !existsSync(rootHttpBin)) {
  console.error(
    '[prepack-bundle-core] root server dist missing; running npm run build:root (tsc + copy:assets)'
  );
  execSync('npm run build:root', { cwd: root, stdio: 'inherit' });
}

function shouldInclude(absPath) {
  const rel = relative(coreSrc, absPath);
  if (rel === '' || rel === '.') return true;
  const norm = rel.replace(/\\/g, '/');
  if (norm === 'node_modules' || norm.startsWith('node_modules/')) return false;
  if (norm === 'src' || norm.startsWith('src/')) return false;
  return true;
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(root, 'node_modules'), { recursive: true });

cpSync(coreSrc, dest, {
  recursive: true,
  filter: (src) => shouldInclude(src),
});

console.log(
  '[prepack-bundle-core] Copied packages/memento-core → node_modules/@memento/core (for tarball bundle)'
);
