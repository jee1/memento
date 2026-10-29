import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkChangelogGate,
  checkPrChangelogGate,
  checkVersionSync,
  countUnreleasedEntries,
  extractUnreleasedSection,
  hasNoChangelogLabel,
  isExemptPrTitle,
  isUnreleasedSectionUpdated,
  isUserFacingPath,
  MANIFEST_PATHS,
} from './check-version-sync.js';

let root: string;

const writeTarget = (relativePath: string, version: string) => {
  const full = join(root, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  if (relativePath.endsWith('.mcp.json')) {
    writeFileSync(
      full,
      `${JSON.stringify(
        {
          mcpServers: {
            memento: {
              command: 'npx',
              args: ['-y', `memento-mcp-server@${version}`],
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    writeFileSync(full, `${JSON.stringify({ name: 'test', version }, null, 2)}\n`);
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'version-sync-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkVersionSync', () => {
  it('네 대상의 버전이 같을 때 위반이 0건이다', () => {
    for (const file of MANIFEST_PATHS) {
      writeTarget(file, '1.0.0');
    }
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(0);
    expect(result.manifests).toHaveLength(4);
  });

  it('매니페스트 버전 중 하나가 다를 때 위반이 보고된다', () => {
    for (const file of MANIFEST_PATHS) {
      writeTarget(file, '1.0.0');
    }
    writeTarget('packages/memento-server/package.json', '1.1.0');
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(4);
    expect(result.violations.map((entry) => entry.version)).toEqual([
      '1.0.0',
      '1.0.0',
      '1.1.0',
      '1.0.0',
    ]);
  });

  it('plugins/memento/.mcp.json 버전이 다를 때 위반이 보고된다', () => {
    for (const file of MANIFEST_PATHS) {
      writeTarget(file, '1.0.0');
    }
    writeTarget('plugins/memento/.mcp.json', '0.9.0');
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(4);
    expect(result.violations.map((entry) => entry.version)).toEqual([
      '1.0.0',
      '1.0.0',
      '1.0.0',
      '0.9.0',
    ]);
  });

  it('plugins/memento/.mcp.json 이 latest 로 설정되어 있으면 불일치로 위반 보고된다', () => {
    for (const file of MANIFEST_PATHS) {
      writeTarget(file, '2.3.4');
    }
    writeTarget('plugins/memento/.mcp.json', 'latest');
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(4);
    expect(result.violations.find((v) => v.file === 'plugins/memento/.mcp.json')?.version).toBe('latest');
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

describe('isUserFacingPath', () => {
  it('packages 하위 src 와 static 은 사용자 영향 경로로 판정한다', () => {
    expect(isUserFacingPath('packages/memento-core/src/index.ts')).toBe(true);
    expect(isUserFacingPath('packages/memento-server/src/server.ts')).toBe(true);
    expect(isUserFacingPath('packages/memento-client/src/client.ts')).toBe(true);
    expect(isUserFacingPath('static/index.html')).toBe(true);
    expect(isUserFacingPath('apps/dashboard/src/main.ts')).toBe(true);
  });

  it('docs, scripts, .github, 설정 파일 등은 사용자 영향 경로에서 제외한다', () => {
    expect(isUserFacingPath('docs/architecture.md')).toBe(false);
    expect(isUserFacingPath('scripts/check-version-sync.ts')).toBe(false);
    expect(isUserFacingPath('.github/workflows/ci.yml')).toBe(false);
    expect(isUserFacingPath('package.json')).toBe(false);
    expect(isUserFacingPath('CHANGELOG.md')).toBe(false);
  });
});

describe('isExemptPrTitle', () => {
  it('test, docs, chore, style, ci 제목 타입은 예외로 인정한다', () => {
    expect(isExemptPrTitle('test: add unit test')).toBe(true);
    expect(isExemptPrTitle('test(core): add regression test')).toBe(true);
    expect(isExemptPrTitle('test!: breaking test')).toBe(true);
    expect(isExemptPrTitle('docs: update manual')).toBe(true);
    expect(isExemptPrTitle('chore: bump dependency')).toBe(true);
    expect(isExemptPrTitle('style: format code')).toBe(true);
    expect(isExemptPrTitle('ci: update workflow')).toBe(true);
    expect(isExemptPrTitle('CI: uppercase prefix')).toBe(true);
  });

  it('feat, fix, perf, refactor 및 비형식 제목은 예외가 아니다', () => {
    expect(isExemptPrTitle('feat: new feature')).toBe(false);
    expect(isExemptPrTitle('fix: solve bug')).toBe(false);
    expect(isExemptPrTitle('fix(graph): address edge case')).toBe(false);
    expect(isExemptPrTitle('perf: optimize query')).toBe(false);
    expect(isExemptPrTitle('refactor: rewrite module')).toBe(false);
    expect(isExemptPrTitle('random commit message')).toBe(false);
    expect(isExemptPrTitle('')).toBe(false);
  });
});

describe('hasNoChangelogLabel', () => {
  it('no-changelog 라벨이 있으면 true 를 반환한다', () => {
    expect(hasNoChangelogLabel(['no-changelog'])).toBe(true);
    expect(hasNoChangelogLabel(['NO-CHANGELOG'])).toBe(true);
    expect(hasNoChangelogLabel(['bug', 'no-changelog'])).toBe(true);
  });

  it('no-changelog 라벨이 없으면 false 를 반환한다', () => {
    expect(hasNoChangelogLabel([])).toBe(false);
    expect(hasNoChangelogLabel(['enhancement', 'bug'])).toBe(false);
  });
});

describe('extractUnreleasedSection & isUnreleasedSectionUpdated', () => {
  it('Unreleased 섹션 내용만 올바르게 추출한다', () => {
    const content = changelogWith('\n### Added\n- 새 항목 1\n');
    const unreleased = extractUnreleasedSection(content);
    expect(unreleased).toContain('### Added');
    expect(unreleased).toContain('- 새 항목 1');
    expect(unreleased).not.toContain('이전 릴리스 항목');
  });

  it('Unreleased 절의 내용이 변경되었을 때 true 를 반환한다', () => {
    const baseChangelog = changelogWith('\n- 기존 항목\n');
    const headChangelog = changelogWith('\n- 기존 항목\n- 새 항목 추가\n');
    expect(isUnreleasedSectionUpdated(baseChangelog, headChangelog)).toBe(true);
  });

  it('과거 릴리스 절만 수정되고 Unreleased 절이 같으면 false 를 반환한다', () => {
    const baseChangelog = `# Changelog\n\n## [Unreleased]\n\n- 유지 항목\n\n## [1.32.0] - 2026-09-20\n\n- 과거 항목\n`;
    const headChangelog = `# Changelog\n\n## [Unreleased]\n\n- 유지 항목\n\n## [1.32.0] - 2026-09-20\n\n- 과거 항목 오타 수정\n`;
    expect(isUnreleasedSectionUpdated(baseChangelog, headChangelog)).toBe(false);
  });
});

describe('checkPrChangelogGate (#1489)', () => {
  const userFacingFile = 'packages/memento-core/src/index.ts';
  const baseChangelog = changelogWith('\n- 이전 항목\n');
  const updatedHeadChangelog = changelogWith('\n- 이전 항목\n- 신규 반영 항목 (#1489)\n');

  it('사용자 영향 경로가 변경되었는데 CHANGELOG.md 가 없으면 위반이다', () => {
    const result = checkPrChangelogGate({
      changedFiles: [userFacingFile],
      title: 'feat: add awesome feature',
    });
    expect(result.violated).toBe(true);
    expect(result.skipReason).toBeNull();
    expect(result.userFacingFiles).toEqual([userFacingFile]);
    expect(result.reason).toContain('CHANGELOG.md 가 수정되지 않았습니다');
  });

  it('이슈 #1489 에 언급된 누락 PR 유형(perf, fix)은 CHANGELOG 가 없으면 차단된다', () => {
    const perfResult = checkPrChangelogGate({
      changedFiles: ['packages/memento-server/src/server.ts'],
      title: 'perf: optimize cache throughput (#1479)',
    });
    expect(perfResult.violated).toBe(true);

    const fixResult = checkPrChangelogGate({
      changedFiles: ['packages/memento-core/src/graph.ts'],
      title: 'fix(graph): resolve cycle (#1485)',
    });
    expect(fixResult.violated).toBe(true);

    const fixJevResult = checkPrChangelogGate({
      changedFiles: ['packages/memento-core/src/jev.ts'],
      title: 'fix(Jev 판정): fix threshold logic (#1472)',
    });
    expect(fixJevResult.violated).toBe(true);
  });

  it('사용자 영향 경로가 변경되었더라도 CHANGELOG [Unreleased] 가 함께 수정되면 통과한다', () => {
    const result = checkPrChangelogGate({
      changedFiles: [userFacingFile, 'CHANGELOG.md'],
      title: 'feat: add awesome feature',
      baseChangelog,
      headChangelog: updatedHeadChangelog,
    });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBeNull();
  });

  it('CHANGELOG.md 가 변경 목록에 있으나 [Unreleased] 절 내용에 변화가 없으면 위반이다', () => {
    const unmodifiedHeadChangelog = `# Changelog\n\n## [Unreleased]\n\n- 이전 항목\n\n## [1.32.0] - 2026-09-20\n\n- 오타 수정만 발생\n`;
    const result = checkPrChangelogGate({
      changedFiles: [userFacingFile, 'CHANGELOG.md'],
      title: 'feat: add awesome feature',
      baseChangelog,
      headChangelog: unmodifiedHeadChangelog,
    });
    expect(result.violated).toBe(true);
    expect(result.reason).toContain('[Unreleased] 절 내용에 변경이 없습니다');
  });

  it('사용자 영향 경로가 변경되지 않은 PR 은 통과한다', () => {
    const result = checkPrChangelogGate({
      changedFiles: ['docs/README.md', 'scripts/helper.ts', '.github/workflows/ci.yml'],
      title: 'chore: update docs and scripts',
    });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBe('no-user-facing-changes');
  });

  it('사용자 영향 경로가 바뀌었어도 예외 제목 타입(test, docs, chore, style, ci)은 통과한다', () => {
    for (const title of [
      'test(core): add edge-case test',
      'docs: update inline comments in src',
      'chore: clean up internal deps',
      'style: fix formatting',
      'ci: adjust pipeline config',
    ]) {
      const result = checkPrChangelogGate({
        changedFiles: [userFacingFile],
        title,
      });
      expect(result.violated).toBe(false);
      expect(result.skipReason).toBe('exempt-title');
    }
  });

  it('사용자 영향 경로가 바뀌었어도 no-changelog 라벨이 있으면 통과한다', () => {
    const result = checkPrChangelogGate({
      changedFiles: [userFacingFile],
      title: 'refactor: internal clean up',
      labels: ['no-changelog'],
    });
    expect(result.violated).toBe(false);
    expect(result.skipReason).toBe('exempt-label');
  });
});
