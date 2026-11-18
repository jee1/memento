import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFragments } from './release-changelog.js';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- 처음\n';

describe('release-changelog (#1780)', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' });
  const writeFragment = (name: string, text: string) => {
    mkdirSync(join(root, 'changelog.d'), { recursive: true });
    writeFileSync(join(root, 'changelog.d', name), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'release-changelog-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('readFragments', () => {
    it('폴더가 없으면 빈 결과다', () => {
      expect(readFragments(root)).toEqual({ fragments: [], problems: [] });
    });

    it('README 는 건너뛰고 조각을 읽으며 형식이 틀린 조각은 문제로 모은다', () => {
      writeFragment('README.md', '# 설명');
      writeFragment('1-ok.md', 'Added\n- 하나\n');
      writeFragment('2-bad.md', 'Oops\n- 둘\n');
      const { fragments, problems } = readFragments(root);
      expect(fragments.map((f) => f.file)).toEqual(['1-ok.md']);
      expect(problems.map((p) => p.file)).toEqual(['2-bad.md']);
    });
  });

  it('서로 다른 두 PR 이 각자 조각 하나를 더하면 어느 순서로 합쳐도 충돌하지 않는다', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
    writeFragment('README.md', '# 설명');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    for (const [branch, file, text] of [
      ['pr-a', '1001-a.md', 'Added\n- A 가 더한 항목 (#1001)\n'],
      ['pr-b', '1002-b.md', 'Added\n- B 가 더한 항목 (#1002)\n'],
    ] as const) {
      git('checkout', '-q', '-b', branch, 'main');
      writeFragment(file, text);
      git('add', '-A');
      git('commit', '-q', '-m', branch);
      git('checkout', '-q', 'main');
    }

    git('merge', '-q', '--no-edit', 'pr-a');
    // 같은 PR 이 CHANGELOG.md 의 같은 자리를 고쳤다면 여기서 충돌한다. 조각은 파일이 달라 그대로 합쳐진다.
    expect(() => git('merge', '-q', '--no-edit', 'pr-b')).not.toThrow();
    expect(readFragments(root).fragments.map((f) => f.file)).toEqual(['1001-a.md', '1002-b.md']);
  });

  it('대조군: 두 PR 이 CHANGELOG.md 의 같은 자리에 줄을 더하면 충돌한다', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n\n- 기존\n'));
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    for (const [branch, line] of [['pr-a', '- A'], ['pr-b', '- B']] as const) {
      git('checkout', '-q', '-b', branch, 'main');
      writeFileSync(join(root, 'CHANGELOG.md'), readFileSync(join(root, 'CHANGELOG.md'), 'utf-8').replace('- 기존\n', `- 기존\n${line}\n`));
      git('commit', '-q', '-am', branch);
      git('checkout', '-q', 'main');
    }
    git('merge', '-q', '--no-edit', 'pr-a');
    expect(() => git('merge', '-q', '--no-edit', 'pr-b')).toThrow();
  });
});
