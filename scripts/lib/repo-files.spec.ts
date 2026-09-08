import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRepoFiles } from './repo-files.js';

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

describe('listRepoFiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-files-'));
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'test');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(relPath: string, content = 'x'): void {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it('gitignore 된 경로를 제외하고 커밋 가능한 파일만 반환한다', () => {
    write('.gitignore', '.omx/\n');
    write('tracked.md');
    write('.omx/state/session.md');
    git(root, 'add', '.gitignore', 'tracked.md');
    git(root, 'commit', '--quiet', '-m', 'init');

    // 아직 추적되지 않았지만 gitignore 대상도 아닌 파일은 포함해야 한다.
    write('untracked.md');

    const relPaths = listRepoFiles(root).map((file) => file.relPath);

    expect(relPaths).toContain('tracked.md');
    expect(relPaths).toContain('untracked.md');
    expect(relPaths).not.toContain('.omx/state/session.md');
  });

  it('인덱스에는 있지만 작업 트리에서 지워진 파일은 제외한다', () => {
    write('gone.md');
    git(root, 'add', 'gone.md');
    git(root, 'commit', '--quiet', '-m', 'init');
    fs.rmSync(path.join(root, 'gone.md'));

    expect(listRepoFiles(root).map((file) => file.relPath)).not.toContain('gone.md');
  });

  it('반환한 절대 경로로 파일을 읽을 수 있다', () => {
    write('doc.md', '# hello');
    git(root, 'add', 'doc.md');
    git(root, 'commit', '--quiet', '-m', 'init');

    const file = listRepoFiles(root).find((entry) => entry.relPath === 'doc.md');

    expect(file).toBeDefined();
    expect(fs.readFileSync(file!.full, 'utf8')).toBe('# hello');
  });
});
