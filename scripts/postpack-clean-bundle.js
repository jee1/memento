#!/usr/bin/env node
/**
 * prepack 이 dist/node_modules/@memento/* 로 복사해 둔 번들 사본을 pack 이 끝난 뒤 지운다 (#1038).
 *
 * 남아 있어도 다음 prepack 이 덮어쓰고 dist/ 는 git 이 무시하지만,
 * 개발 트리에서 dist/ 를 실행할 때 낡은 사본이 해석되는 것을 막는다.
 */
import { existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(root, 'dist/node_modules/@memento');

if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
  console.log('[postpack-clean-bundle] removed', bundleDir);
} else {
  console.log('[postpack-clean-bundle] nothing to clean');
}
