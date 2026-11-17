#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * 지운 이름의 남은 언급 검사 (문서 동반 수정 규칙의 기계 검사)
 *
 * merge-base 대비 diff 에서 지워진 export 와 클래스 메서드 이름을 뽑아,
 * 아직 어디에도 정의가 남지 않은 이름이 코드나 docs 에 남아 있으면 목록을 찍고 exit 1 입니다.
 *
 * 사용법:
 *   npx tsx scripts/check-removed-names.ts [옵션]
 *
 * 옵션:
 *   --base=<ref>     비교 기준 (기본값: origin/main 과 HEAD 의 merge-base)
 *   --allow=<a,b>    남겨도 되는 이름 (이력 서술 등). PR 본문에 「남긴 언급과 이유」를 적는다
 *
 * 오탐을 줄이는 규칙은 세 가지뿐입니다.
 * 1. 이름이 짧거나 흔한 낱말이면 무시한다 (camelCase/PascalCase/snake_case 이고 6자 이상만).
 * 2. diff 에서 다시 추가한 이름(다른 파일로 옮긴 경우 포함)은 무시한다. 같은 이름의 정의가 다른 곳에
 *    남아 있으면(다른 클래스의 같은 메서드 이름) 코드의 언급은 그 정의를 부르는 것일 수 있으니 docs 의 언급만 본다.
 * 3. 이력을 적는 곳(CHANGELOG.md, docs/adr/)과 spec 파일의 지워진 줄은 보지 않는다.
 */

import { execFileSync } from 'node:child_process';

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const HISTORY_PATHSPECS = [':!CHANGELOG.md', ':!docs/adr/'];
const SEARCH_PATHSPECS = ['*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs', '*.md', '*.mdx'];
const DOC_FILE = /\.mdx?$/;
const MIN_NAME_LENGTH = 6;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor', 'return', 'with']);

const EXPORT_DECL = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const METHOD_DECL = /^\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/;

/** 흔한 낱말을 버리는 규칙: 한 낱말 소문자(`execute`, `process`)는 이름으로 보지 않는다. */
export function isDistinctiveName(name: string): boolean {
  return name.length >= MIN_NAME_LENGTH && !KEYWORDS.has(name) && /[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/.test(name);
}

export interface DiffLines {
  removed: Map<string, Set<string>>;
  added: string[];
}

/** `git diff -U0` 텍스트에서 코드 파일(spec 제외)의 줄을 지운 줄과 더한 줄로 나눈다. */
export function parseDiff(diff: string): DiffLines {
  const removed = new Map<string, Set<string>>();
  const added: string[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('--- ')) {
      continue;
    } else if (line.startsWith('+')) {
      added.push(line.slice(1));
    } else if (line.startsWith('-') && CODE_FILE.test(file) && !SPEC_FILE.test(file)) {
      const text = line.slice(1);
      const name = EXPORT_DECL.exec(text)?.[1] ?? METHOD_DECL.exec(text)?.[1];
      if (name && isDistinctiveName(name)) {
        const files = removed.get(name) ?? new Set<string>();
        files.add(file);
        removed.set(name, files);
      }
    }
  }
  return { removed, added };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 이 이름을 정의하는 줄인지. 호출이나 import 줄은 정의가 아니다. */
export function definesName(line: string, name: string): boolean {
  const n = escapeRegExp(name);
  return (
    new RegExp(`\\b(?:function\\*?|class|interface|type|enum|const|let|var)\\s+${n}\\b`).test(line) ||
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\\s+)*${n}\\s*(?:<[^>(]*>)?\\([^)]*\\)\\s*(?::\\s*[^{=]+)?\\{\\s*$`).test(line)
  );
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // git grep 은 일치가 없으면 exit 1 이다.
    const e = error as { status?: number; stdout?: string };
    if (e.status === 1) return e.stdout ?? '';
    throw error;
  }
}

export interface Mention {
  name: string;
  location: string;
}

/** 지운 이름 중 정의가 남지 않았는데 언급이 남은 곳을 찾는다. */
export function findRemainingMentions(base: string, cwd: string, allow: ReadonlySet<string> = new Set()): Mention[] {
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', base, '--', ...HISTORY_PATHSPECS], cwd);
  const { removed, added } = parseDiff(diff);
  const mentions: Mention[] = [];
  for (const name of [...removed.keys()].sort()) {
    if (allow.has(name) || added.some((line) => definesName(line, name))) continue;
    const hits = git(['grep', '-nwF', '-I', name, '--', ...SEARCH_PATHSPECS, ...HISTORY_PATHSPECS], cwd).split('\n').filter(Boolean);
    const stillDefined = hits.some((hit) => definesName(hit.replace(/^[^:]*:\d+:/, ''), name));
    for (const hit of hits) {
      const location = hit.replace(/^([^:]*:\d+):.*$/, '$1');
      if (!stillDefined || DOC_FILE.test(location.split(':')[0])) mentions.push({ name, location });
    }
  }
  return mentions;
}

function resolveBase(arg: string | undefined, cwd: string): string {
  if (arg) return arg;
  return git(['merge-base', 'origin/main', 'HEAD'], cwd).trim();
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const option = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const cwd = process.cwd();
  const base = resolveBase(option('base'), cwd);
  const allow = new Set(option('allow')?.split(',').filter(Boolean));
  const mentions = findRemainingMentions(base, cwd, allow);
  if (mentions.length === 0) {
    console.log('check-removed-names: 지운 이름의 남은 언급 없음');
    return 0;
  }
  console.error('check-removed-names: 지운 이름이 아직 언급된다. 문서와 코드를 고치거나 이력이면 --allow 로 두고 PR 본문에 이유를 적는다.');
  for (const m of mentions) console.error(`  ${m.name}\t${m.location}`);
  return 1;
}

if (isMain(import.meta.url)) {
  process.exit(main());
}
