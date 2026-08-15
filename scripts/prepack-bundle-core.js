#!/usr/bin/env node
/**
 * npm pack / npm publish 시 bundledDependencies에 @memento/core · @memento/agent-integration 이
 * 실려야 하는데, 워크스페이스는 보통 node_modules/@memento/* → packages/* 심볼릭 링크라
 * npm이 tarball에 실어 넣지 않는다. `npm pack --dry-run`의 bundled files: 0 표시는 신뢰하지 말고
 * `npm run verify-pack-bundle`로 실제 .tgz 안에
 * package/node_modules/@memento/core/dist/index.js 및
 * package/node_modules/@memento/agent-integration/dist/index.js 가 있는지 확인한다.
 * 패킹 직전에 실제 디렉터리로 복사해 tarball에 workspace 패키지가 포함되도록 한다.
 * @see https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundleddependencies
 *
 * pack 단계가 prepack 직후 실패하면 postpack이 돌지 않아 node_modules/@memento/* 가 복사본으로 남을 수 있다.
 * 다음 prepack 시작 시 워크스페이스 링크를 먼저 복구한 뒤 다시 복사해, 이전 실패로 남은 복사본을 정리한다.
 * 권장: `npm run pack:tarball` 또는 실패 직후 `npm run restore-workspace`.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/** @typedef {{ name: string, srcRel: string, destRel: string, distEntry: string, buildCmd: string }} BundleTarget */

/** @type {BundleTarget[]} */
const BUNDLE_TARGETS = [
  {
    name: '@memento/core',
    srcRel: 'packages/memento-core',
    destRel: 'node_modules/@memento/core',
    distEntry: 'dist/index.js',
    buildCmd: 'npm run build -w @memento/core',
  },
  {
    name: '@memento/agent-integration',
    srcRel: 'packages/memento-agent-integration',
    destRel: 'node_modules/@memento/agent-integration',
    distEntry: 'dist/index.js',
    buildCmd: 'npm run build -w @memento/agent-integration',
  },
];

try {
  execSync('node scripts/postpack-restore-workspace.js', { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.error('[prepack-bundle-core] 워크스페이스 링크 복구(시작 시) 실패:', e);
  process.exit(1);
}

for (const target of BUNDLE_TARGETS) {
  const src = join(root, target.srcRel);
  if (!existsSync(join(src, 'package.json'))) {
    console.error(`[prepack-bundle-core] ${target.srcRel} not found`);
    process.exit(1);
  }
  if (!existsSync(join(src, target.distEntry))) {
    console.error(`[prepack-bundle-core] ${target.name} dist missing; running ${target.buildCmd}`);
    execSync(target.buildCmd, { cwd: root, stdio: 'inherit' });
  }
}

const rootMcpBin = join(root, 'dist/server/index.js');
const rootHttpBin = join(root, 'dist/server/http-server.js');
if (!existsSync(rootMcpBin) || !existsSync(rootHttpBin)) {
  console.error(
    '[prepack-bundle-core] root server dist missing; running npm run build:root (tsc + copy:assets)'
  );
  execSync('npm run build:root', { cwd: root, stdio: 'inherit' });
}

/**
 * @param {string} pkgSrc
 * @param {string} absPath
 */
function shouldInclude(pkgSrc, absPath) {
  const rel = relative(pkgSrc, absPath);
  if (rel === '' || rel === '.') return true;
  const norm = rel.replace(/\\/g, '/');
  if (norm === 'node_modules' || norm.startsWith('node_modules/')) return false;
  if (norm === 'src' || norm.startsWith('src/')) return false;
  return true;
}

mkdirSync(join(root, 'node_modules'), { recursive: true });

for (const target of BUNDLE_TARGETS) {
  const src = join(root, target.srcRel);
  const dest = join(root, target.destRel);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (abs) => shouldInclude(src, abs),
  });
  console.log(
    `[prepack-bundle-core] Copied ${target.srcRel} → ${target.destRel} (for tarball bundle)`
  );
}
