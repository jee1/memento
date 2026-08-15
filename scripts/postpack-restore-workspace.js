#!/usr/bin/env node
/**
 * prepack에서 node_modules/@memento/{core,agent-integration} 을 디렉터리 복사본으로 바꾼 뒤,
 * 로컬 개발 시 워크스페이스 링크로 되돌린다.
 *
 * 전체 `npm install`은 postinstall(auto-setup 등)을 다시 돌려 CI/패킹 환경을 오염시키므로 쓰지 않는다.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ destRel: string, pkgRel: string, label: string }[]} */
const RESTORE_TARGETS = [
  {
    destRel: 'node_modules/@memento/core',
    pkgRel: 'packages/memento-core',
    label: '@memento/core',
  },
  {
    destRel: 'node_modules/@memento/agent-integration',
    pkgRel: 'packages/memento-agent-integration',
    label: '@memento/agent-integration',
  },
];

let restored = 0;
for (const target of RESTORE_TARGETS) {
  const dest = join(root, target.destRel);
  const pkg = join(root, target.pkgRel);

  if (!existsSync(join(pkg, 'package.json'))) {
    console.warn(
      `[postpack-restore-workspace] ${target.pkgRel} 가 없습니다. ${target.label} 복구를 건너뜁니다.`
    );
    continue;
  }

  try {
    rmSync(dest, { recursive: true, force: true });
  } catch {
    // ignore
  }

  mkdirSync(dirname(dest), { recursive: true });

  if (process.platform === 'win32') {
    symlinkSync(resolve(pkg), dest, 'junction');
    console.log('[postpack-restore-workspace] junction 복구:', dest, '->', resolve(pkg));
  } else {
    const rel = relative(dirname(dest), pkg);
    symlinkSync(rel, dest, 'dir');
    console.log('[postpack-restore-workspace] symlink 복구:', dest, '->', rel);
  }
  restored += 1;
}

if (restored === 0) {
  console.warn(
    '[postpack-restore-workspace] 복구할 워크스페이스 패키지가 없습니다. 모노레포 밖에서는 정상일 수 있습니다.'
  );
}
