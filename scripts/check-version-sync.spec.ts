import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkChangelogGate, checkVersionSync, countUnreleasedEntries } from './check-version-sync.js';

const MANIFEST_PATHS = [
  'package.json',
  'packages/memento-core/package.json',
  'packages/memento-server/package.json',
];

let root: string;

const writeManifest = (relativePath: string, version: string) => {
  const full = join(root, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${JSON.stringify({ name: 'test', version }, null, 2)}\n`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'version-sync-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkVersionSync', () => {
  it('세 버전이 같을 때 위반이 0건이다', () => {
    for (const file of MANIFEST_PATHS) {
      writeManifest(file, '1.0.0');
    }
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(0);
    expect(result.manifests).toHaveLength(3);
  });

  it('세 버전 중 하나가 다를 때 위반이 보고된다', () => {
    writeManifest('package.json', '1.0.0');
    writeManifest('packages/memento-core/package.json', '1.0.0');
    writeManifest('packages/memento-server/package.json', '1.1.0');
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(3);
    expect(result.violations.map((entry) => entry.version)).toEqual(['1.0.0', '1.0.0', '1.1.0']);
  });
});

const changelogWith = (unreleasedBody: string) =>
  `# Changelog\n\n## [Unreleased]\n${unreleasedBody}\n## [1.32.0] - 2026-09-20\n\n### Added\n\n- 이전 릴리스 항목\n`;

describe('countUnreleasedEntries', () => {
  it('다음 버전 절의 항목은 세지 않는다', () => {
    expect(countUnreleasedEntries(changelogWith('\n### Added\n\n- 하나\n- 둘\n\n'))).toBe(2);
  });

  it('비어 있으면 0 이다', () => {
    expect(countUnreleasedEntries(changelogWith('\n<!-- 주석만 있다 -->\n\n'))).toBe(0);
  });
});

describe('checkChangelogGate', () => {
  const base = { packageVersion: '1.32.0', lastTag: '1.32.0', commitsSinceTag: 16 };

  it('태그 이후 커밋이 있는데 Unreleased 가 비면 위반이다', () => {
    const result = checkChangelogGate({ ...base, changelog: changelogWith('\n') });
    expect(result.violated).toBe(true);
    expect(result.skipReason).toBeNull();
  });

  it('Unreleased 에 항목이 있으면 통과한다', () => {
    const result = checkChangelogGate({ ...base, changelog: changelogWith('\n- 하나\n\n') });
    expect(result.violated).toBe(false);
    expect(result.entryCount).toBe(1);
  });

  it('매니페스트가 태그보다 앞서면 릴리스 준비로 보고 생략한다', () => {
    const result = checkChangelogGate({
      ...base,
      packageVersion: '1.33.0',
      changelog: changelogWith('\n'),
    });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBe('release-prep');
  });

  it('태그 선행 v 는 비교에서 무시한다', () => {
    const result = checkChangelogGate({ ...base, lastTag: 'v1.32.0', changelog: changelogWith('\n') });
    expect(result.violated).toBe(true);
  });

  it('태그를 못 찾으면 생략한다', () => {
    const result = checkChangelogGate({ ...base, lastTag: null, changelog: changelogWith('\n') });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBe('no-tag');
  });

  it('태그 이후 커밋이 없으면 생략한다', () => {
    const result = checkChangelogGate({ ...base, commitsSinceTag: 0, changelog: changelogWith('\n') });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBe('no-commits');
  });
});
