/**
 * CHANGELOG 조각 파일 (#1780)
 *
 * PR 마다 `CHANGELOG.md` 의 같은 자리(`[Unreleased]` 각 절의 끝)에 줄을 넣으면 먼저 병합된 PR 이 뒤의 PR 을
 * 차례로 충돌시킨다. 그래서 PR 은 `changelog.d/<이슈번호>-<짧은이름>.md` 한 파일만 더하고, 릴리스 준비 때
 * `release-changelog.ts` 가 이 조각들을 `CHANGELOG.md` 의 새 버전 절로 합쳐 지운다.
 *
 * 조각 파일 형식 (절 하나, 항목 하나 이상):
 *
 *     Fixed
 *     - 한 줄짜리 항목 (#1781)
 *     - 이어지는 줄은 앞에 두 칸 들여 쓴다.
 *
 * 이 모듈은 파일 시스템을 만지지 않는다. 읽고 쓰는 일은 호출하는 스크립트가 한다.
 */

export const FRAGMENT_DIR = 'changelog.d';
export const SECTION_ORDER = ['Added', 'Changed', 'Fixed', 'Removed', 'Security'] as const;
export type Section = (typeof SECTION_ORDER)[number];

export interface Fragment {
  /** `changelog.d/` 안의 파일 이름 */
  file: string;
  section: Section;
  /** 항목 하나가 한 덩어리(첫 줄 + 이어지는 줄). `- ` 로 시작한다. */
  entries: string[];
}

export interface FragmentProblem {
  file: string;
  message: string;
}

const FILE_NAME_RE = /^\d+-[a-z0-9][a-z0-9-]*\.md$/;

/** README 와 숨김 파일은 조각이 아니다. */
export function isFragmentFileName(name: string): boolean {
  return name.endsWith('.md') && name.toLowerCase() !== 'readme.md' && !name.startsWith('.');
}

/** 경로가 `changelog.d/` 아래 조각 파일인지(변경 파일 목록에서 걸러 쓴다). */
export function isFragmentPath(path: string): boolean {
  const m = /^changelog\.d\/([^/]+)$/.exec(path);
  return m !== null && isFragmentFileName(m[1] ?? '');
}

/**
 * 조각 하나를 읽는다. 형식이 틀리면 문제 목록을 돌려주고 조각은 null 이다.
 * 틀린 조각이 릴리스 때 합치기를 깨뜨리지 않도록 PR 때 걸러 내려는 것이다.
 */
export function parseFragment(file: string, text: string): { fragment: Fragment | null; problems: FragmentProblem[] } {
  const problems: FragmentProblem[] = [];
  const fail = (message: string) => problems.push({ file, message });

  if (!FILE_NAME_RE.test(file)) {
    fail('파일 이름이 `<이슈번호>-<짧은이름>.md` (소문자, 숫자, 하이픈) 형식이 아니다');
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = (lines[0] ?? '').trim();
  if (!(SECTION_ORDER as readonly string[]).includes(first)) {
    fail(`첫 줄은 절 이름이어야 한다: ${SECTION_ORDER.join(', ')} 중 하나 (지금: ${JSON.stringify(first)})`);
    return { fragment: null, problems };
  }
  const section = first as Section;

  const entries: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    if (line.startsWith('- ')) {
      entries.push(line.trimEnd());
    } else if (line.startsWith('  ') && entries.length > 0) {
      entries[entries.length - 1] += `\n${line.trimEnd()}`;
    } else {
      fail(`항목은 \`- \` 로 시작해야 하고 이어지는 줄은 두 칸 들여 써야 한다: ${JSON.stringify(line.slice(0, 40))}`);
    }
  }
  if (entries.length === 0) fail('항목이 하나도 없다');
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) fail('충돌 표식이 남아 있다');

  if (problems.length > 0) return { fragment: null, problems };
  return { fragment: { file, section, entries }, problems };
}

/** 파일 이름순(= 이슈 번호가 같으면 짧은이름순)으로 정렬한다. 번호는 숫자로 비교한다. */
export function sortFragments(fragments: readonly Fragment[]): Fragment[] {
  const num = (f: Fragment) => Number.parseInt(f.file, 10);
  return [...fragments].sort((a, b) => num(a) - num(b) || a.file.localeCompare(b.file));
}

/** `## [Unreleased]` 절 본문(다음 `## [` 직전까지)에서 절 이름별 항목을 뽑는다. 이행기에 남은 기존 항목이다. */
export function parseUnreleasedEntries(changelog: string): Map<Section, string[]> {
  const bySection = new Map<Section, string[]>();
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start === -1) return bySection;

  let section: Section | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line)) break;
    const h = /^### (\S+)\s*$/.exec(line);
    if (h) {
      const name = h[1] ?? '';
      section = (SECTION_ORDER as readonly string[]).includes(name) ? (name as Section) : null;
      continue;
    }
    if (section === null) continue;
    if (line.startsWith('- ')) {
      const list = bySection.get(section) ?? [];
      list.push(line.trimEnd());
      bySection.set(section, list);
    } else if (line.startsWith('  ') && line.trim() !== '') {
      const list = bySection.get(section);
      if (list && list.length > 0) list[list.length - 1] += `\n${line.trimEnd()}`;
    }
  }
  return bySection;
}

/** `[Unreleased]` 의 목록 항목 수(`### ` 절 밖의 줄은 세지 않는다). */
export function countUnreleasedListEntries(changelog: string): number {
  let n = 0;
  for (const list of parseUnreleasedEntries(changelog).values()) n += list.length;
  return n;
}

export interface ReleaseMergeResult {
  changelog: string;
  /** 새 버전 절에 들어간 항목 수 */
  entryCount: number;
  /** 새 버전 절에 들어간 조각 파일 이름 */
  consumed: string[];
}

/**
 * `[Unreleased]` 의 기존 항목과 조각들을 `## [version] - date` 절로 합치고 `[Unreleased]` 를 비운다.
 * 기존 항목이 먼저, 조각은 이슈 번호순으로 뒤에 붙는다. 같은 항목이 두 번 들어가지 않는다.
 */
export function mergeIntoRelease(
  changelog: string,
  fragments: readonly Fragment[],
  version: string,
  date: string,
): ReleaseMergeResult {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`버전 형식이 맞지 않는다: ${version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜 형식이 YYYY-MM-DD 가 아니다: ${date}`);
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md 에 ${version} 절이 이미 있다`);
  }

  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start === -1) throw new Error('CHANGELOG.md 에 `## [Unreleased]` 절이 없다');
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end === -1) end = lines.length;

  // 알 수 없는 절 이름이나 절 밖의 항목은 합치는 과정에서 조용히 사라진다. 사라지기 전에 멈춘다.
  const stray = lines.slice(start + 1, end).filter((l) => /^### /.test(l) && !(SECTION_ORDER as readonly string[]).includes(l.slice(4).trim()));
  if (stray.length > 0) throw new Error(`[Unreleased] 에 알 수 없는 절이 있다: ${stray.join(', ')} (${SECTION_ORDER.join('/')} 중 하나로 고친다)`);
  const listLines = lines.slice(start + 1, end).filter((l) => l.startsWith('- ')).length;
  if (listLines !== countUnreleasedListEntries(changelog)) {
    throw new Error('[Unreleased] 에 `### ` 절 밖의 항목이 있다 (합치면 사라진다). 절 아래로 옮긴다');
  }

  const existing = parseUnreleasedEntries(changelog);
  const merged = new Map<Section, string[]>();
  const seen = new Set<string>();
  const add = (section: Section, entry: string) => {
    if (seen.has(entry)) return;
    seen.add(entry);
    const list = merged.get(section) ?? [];
    list.push(entry);
    merged.set(section, list);
  };
  for (const section of SECTION_ORDER) for (const entry of existing.get(section) ?? []) add(section, entry);
  const consumed: string[] = [];
  for (const f of sortFragments(fragments)) {
    consumed.push(f.file);
    for (const entry of f.entries) add(f.section, entry);
  }

  const body: string[] = [];
  let entryCount = 0;
  for (const section of SECTION_ORDER) {
    const list = merged.get(section);
    if (!list || list.length === 0) continue;
    body.push(`### ${section}`, '', ...list.flatMap((e) => e.split('\n')), '');
    entryCount += list.length;
  }

  // `[Unreleased]` 머리글과 안내 주석은 남기고 절 본문은 비운다.
  const head = lines.slice(start, end);
  const keepFromHead: string[] = [];
  for (const line of head) {
    if (/^### /.test(line)) break;
    keepFromHead.push(line);
  }
  while (keepFromHead.length > 0 && (keepFromHead[keepFromHead.length - 1] ?? '').trim() === '') keepFromHead.pop();

  // body 의 마지막 빈 줄 하나는 뒤에 오는 이전 버전 절과의 간격이다. 이전 절 자체는 한 글자도 바꾸지 않는다.
  const out = [
    ...lines.slice(0, start),
    ...keepFromHead,
    '',
    `## [${version}] - ${date}`,
    '',
    ...body,
    ...lines.slice(end),
  ];
  return { changelog: out.join('\n'), entryCount, consumed };
}
