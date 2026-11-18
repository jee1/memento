import { describe, expect, it } from 'vitest';
import {
  countUnreleasedListEntries,
  isFragmentPath,
  mergeIntoRelease,
  parseFragment,
  parseUnreleasedEntries,
  sortFragments,
  type Fragment,
} from './changelog-fragments.js';

const fragment = (file: string, section: Fragment['section'], ...entries: string[]): Fragment => ({ file, section, entries });

const CHANGELOG = `# Changelog

## [Unreleased]

<!-- 안내 주석 -->

### Added

- 기존 추가 항목 (#1000)

### Fixed

- 기존 수정 항목 (#1001)
  이어지는 줄

### Removed

- 기존 제거 항목 (#1002)

## [2.3.10] - 2026-11-09

### Added

- 옛 절의 항목

## [2.3.9] - 2026-11-02

### Fixed

- 더 옛 항목
`;

describe('parseFragment (#1780)', () => {
  it('절 이름과 항목을 읽는다', () => {
    const { fragment: f, problems } = parseFragment('1781-flaky-forgetting.md', 'Fixed\n- 한 줄 (#1781)\n- 두 줄\n  이어짐\n');
    expect(problems).toEqual([]);
    expect(f).toEqual({ file: '1781-flaky-forgetting.md', section: 'Fixed', entries: ['- 한 줄 (#1781)', '- 두 줄\n  이어짐'] });
  });

  it.each([
    ['절 이름이 아닌 첫 줄', '1-a.md', 'Fixes\n- x'],
    ['첫 줄이 항목', '1-a.md', '- x'],
    ['항목이 없다', '1-a.md', 'Fixed\n'],
    ['`- ` 로 시작하지 않는 줄', '1-a.md', 'Fixed\n그냥 문장'],
    ['충돌 표식', '1-a.md', 'Fixed\n- x\n<<<<<<< HEAD\n- y'],
    ['번호 없는 파일 이름', 'flaky.md', 'Fixed\n- x'],
    ['대문자 파일 이름', '1-Flaky.md', 'Fixed\n- x'],
  ])('%s 는 거부한다', (_label, file, text) => {
    const { fragment: f, problems } = parseFragment(file, text);
    expect(f).toBeNull();
    expect(problems.length).toBeGreaterThan(0);
  });

  it('CRLF 줄바꿈도 읽는다', () => {
    expect(parseFragment('1-a.md', 'Added\r\n- x\r\n').fragment?.entries).toEqual(['- x']);
  });
});

describe('isFragmentPath', () => {
  it('changelog.d 바로 아래 조각만 조각이다', () => {
    expect(isFragmentPath('changelog.d/1781-flaky.md')).toBe(true);
    expect(isFragmentPath('changelog.d/README.md')).toBe(false);
    expect(isFragmentPath('changelog.d/sub/1781-flaky.md')).toBe(false);
    expect(isFragmentPath('CHANGELOG.md')).toBe(false);
    expect(isFragmentPath('docs/changelog.d/1-a.md')).toBe(false);
  });
});

describe('sortFragments', () => {
  it('이슈 번호를 숫자로 비교한다 (2 가 10 보다 앞)', () => {
    const sorted = sortFragments([fragment('10-b.md', 'Fixed', '- b'), fragment('2-a.md', 'Fixed', '- a'), fragment('10-a.md', 'Fixed', '- c')]);
    expect(sorted.map((f) => f.file)).toEqual(['2-a.md', '10-a.md', '10-b.md']);
  });
});

describe('parseUnreleasedEntries / countUnreleasedListEntries', () => {
  it('Unreleased 의 절별 항목을 이어지는 줄까지 읽고 다음 버전 절은 세지 않는다', () => {
    const entries = parseUnreleasedEntries(CHANGELOG);
    expect(entries.get('Added')).toEqual(['- 기존 추가 항목 (#1000)']);
    expect(entries.get('Fixed')).toEqual(['- 기존 수정 항목 (#1001)\n  이어지는 줄']);
    expect(entries.get('Removed')).toEqual(['- 기존 제거 항목 (#1002)']);
    expect(countUnreleasedListEntries(CHANGELOG)).toBe(3);
  });

  it('Unreleased 절이 없거나 비어 있으면 0 이다', () => {
    expect(countUnreleasedListEntries('# x\n## [1.0.0] - 2026-01-01\n- a')).toBe(0);
    expect(countUnreleasedListEntries('## [Unreleased]\n\n## [1.0.0]\n- a')).toBe(0);
  });
});

describe('mergeIntoRelease (#1780)', () => {
  const fragments = [
    fragment('1784-usage.md', 'Added', '- 사용 집계 (#1768)'),
    fragment('1781-flaky.md', 'Fixed', '- 가끔 실패 (#1781)'),
    fragment('1790-removal.md', 'Removed', '- 지움 (#1790)'),
  ];

  it('기존 항목이 먼저, 조각은 이슈 번호순으로 새 버전 절에 들어가고 Unreleased 는 비워진다', () => {
    const r = mergeIntoRelease(CHANGELOG, fragments, '2.4.0', '2026-11-23');
    const text = r.changelog;

    expect(r.entryCount).toBe(6);
    expect(r.consumed).toEqual(['1781-flaky.md', '1784-usage.md', '1790-removal.md']);

    const unreleased = text.slice(text.indexOf('## [Unreleased]'), text.indexOf('## [2.4.0]'));
    expect(unreleased).toContain('<!-- 안내 주석 -->');
    expect(unreleased).not.toMatch(/^- /m);
    expect(unreleased).not.toContain('### ');

    const release = text.slice(text.indexOf('## [2.4.0]'), text.indexOf('## [2.3.10]'));
    expect(release.startsWith('## [2.4.0] - 2026-11-23')).toBe(true);
    expect(release.indexOf('### Added')).toBeLessThan(release.indexOf('### Fixed'));
    expect(release.indexOf('### Fixed')).toBeLessThan(release.indexOf('### Removed'));
    expect(release.indexOf('- 기존 추가 항목')).toBeLessThan(release.indexOf('- 사용 집계'));
    expect(release).toContain('- 기존 수정 항목 (#1001)\n  이어지는 줄');
    expect(release).not.toContain('### Changed');
  });

  it('이전 버전 절은 한 글자도 바뀌지 않는다 (연속 빈 줄, 끝 공백, 표 같은 비표준 모양 포함)', () => {
    const odd = CHANGELOG.replace(
      '## [2.3.10] - 2026-11-09\n\n### Added\n\n- 옛 절의 항목\n',
      '## [2.3.10] - 2026-11-09\n\n\n\n### Added   \n\n\n- 옛 절의 항목\n| a | b |\n|---|---|\n',
    );
    expect(odd).not.toBe(CHANGELOG);
    const r = mergeIntoRelease(odd, fragments, '2.4.0', '2026-11-23');
    const tail = (s: string) => s.slice(s.indexOf('## [2.3.10]'));
    expect(tail(r.changelog)).toBe(tail(odd));
  });

  it('조각이 없고 Unreleased 도 비어 있으면 빈 버전 절을 만들지 않고 던지지 않는다 (entryCount 0)', () => {
    const empty = '# Changelog\n\n## [Unreleased]\n\n## [2.3.10] - 2026-11-09\n\n### Added\n\n- a\n';
    const r = mergeIntoRelease(empty, [], '2.4.0', '2026-11-23');
    expect(r.entryCount).toBe(0);
  });

  it('같은 항목이 기존 Unreleased 와 조각에 둘 다 있으면 한 번만 넣는다', () => {
    const dup = [fragment('1000-dup.md', 'Added', '- 기존 추가 항목 (#1000)')];
    const r = mergeIntoRelease(CHANGELOG, dup, '2.4.0', '2026-11-23');
    expect(r.changelog.split('- 기존 추가 항목 (#1000)').length - 1).toBe(1);
    expect(r.entryCount).toBe(3);
  });

  it('이미 있는 버전, 틀린 버전/날짜 형식, Unreleased 가 없는 파일은 던진다', () => {
    expect(() => mergeIntoRelease(CHANGELOG, fragments, '2.3.10', '2026-11-23')).toThrow(/이미 있다/);
    expect(() => mergeIntoRelease(CHANGELOG, fragments, 'v2.4', '2026-11-23')).toThrow(/버전 형식/);
    expect(() => mergeIntoRelease(CHANGELOG, fragments, '2.4.0', '11/23')).toThrow(/날짜 형식/);
    expect(() => mergeIntoRelease('# x\n', fragments, '2.4.0', '2026-11-23')).toThrow(/Unreleased/);
  });

  it('알 수 없는 절이나 절 밖의 항목이 Unreleased 에 있으면 사라지기 전에 던진다', () => {
    const unknown = CHANGELOG.replace('### Removed', '### Deprecated');
    expect(() => mergeIntoRelease(unknown, fragments, '2.4.0', '2026-11-23')).toThrow(/알 수 없는 절.*Deprecated/);
    const outside = CHANGELOG.replace('<!-- 안내 주석 -->\n', '<!-- 안내 주석 -->\n\n- 절 밖 항목\n');
    expect(() => mergeIntoRelease(outside, fragments, '2.4.0', '2026-11-23')).toThrow(/절 밖의 항목/);
  });

  it('합친 결과에서 다시 Unreleased 항목을 세면 0 이고, 새 절 항목 수가 entryCount 와 같다', () => {
    const r = mergeIntoRelease(CHANGELOG, fragments, '2.4.0', '2026-11-23');
    expect(countUnreleasedListEntries(r.changelog)).toBe(0);
    const release = r.changelog.slice(r.changelog.indexOf('## [2.4.0]'), r.changelog.indexOf('## [2.3.10]'));
    expect((release.match(/^- /gm) ?? []).length).toBe(r.entryCount);
  });
});
