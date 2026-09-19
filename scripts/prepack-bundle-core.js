#!/usr/bin/env node
/**
 * npm pack / npm publish 시 @memento/core · @memento/agent-integration 을 tarball 에 실어야 한다.
 * 워크스페이스는 node_modules/@memento/* → packages/* 심볼릭 링크라 npm 이 그대로는 담지 않고,
 * 루트 node_modules 는 bundledDependencies 로 선언해야만 담기는데 그러면 두 이름이 발행 매니페스트의
 * dependencies 에 남아 소비자의 `npm audit signatures` 가 registry 404 로 실패한다 (#1038).
 *
 * 그래서 dist/node_modules/@memento/* 로 복사한다. npm 은 루트 node_modules 는 제외하지만
 * dist 아래의 node_modules 는 tarball 에 담고, 설치 후 dist/server/*.js 에서 상위를 훑으면
 * dist/node_modules 에서 두 패키지가 해석된다. dependencies 선언이 필요 없으므로 404 도 없다.
 *
 * 검증: `npm run verify-pack-bundle` 이 실제 .tgz 안에
 * package/dist/node_modules/@memento/core/dist/index.js 와
 * package/dist/node_modules/@memento/agent-integration/dist/index.js 를 확인한다.
 * (`npm pack --dry-run` 의 bundled files 표시는 신뢰하지 말 것.)
 *
 * 이 스크립트는 루트 node_modules 를 건드리지 않는다. pack 이 중간에 실패해도 워크스페이스 링크는 온전하다.
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
    destRel: 'dist/node_modules/@memento/core',
    distEntry: 'dist/index.js',
    buildCmd: 'npm run build -w @memento/core',
  },
  {
    name: '@memento/agent-integration',
    srcRel: 'packages/memento-agent-integration',
    destRel: 'dist/node_modules/@memento/agent-integration',
    distEntry: 'dist/index.js',
    buildCmd: 'npm run build -w @memento/agent-integration',
  },
];

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

mkdirSync(join(root, 'dist/node_modules/@memento'), { recursive: true });

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
