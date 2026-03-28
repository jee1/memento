#!/usr/bin/env node
/**
 * prepack에서 node_modules/@memento/core 를 디렉터리 복사본으로 바꾼 뒤,
 * 로컬 개발 시 워크스페이스 링크로 되돌린다.
 *
 * 전체 `npm install`은 postinstall(auto-setup 등)을 다시 돌려 CI/패킹 환경을 오염시키므로 쓰지 않는다.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'node_modules/@memento/core');
const corePkg = join(root, 'packages/memento-core');

if (!existsSync(join(corePkg, 'package.json'))) {
  console.warn(
    '[postpack-restore-workspace] packages/memento-core 가 없습니다. 모노레포 밖에서는 복구를 건너뜁니다.'
  );
  process.exit(0);
}

try {
  rmSync(dest, { recursive: true, force: true });
} catch {
  // ignore
}

mkdirSync(dirname(dest), { recursive: true });

if (process.platform === 'win32') {
  symlinkSync(resolve(corePkg), dest, 'junction');
  console.log('[postpack-restore-workspace] junction 복구:', dest, '->', resolve(corePkg));
} else {
  const rel = relative(dirname(dest), corePkg);
  symlinkSync(rel, dest, 'dir');
  console.log('[postpack-restore-workspace] symlink 복구:', dest, '->', rel);
}
