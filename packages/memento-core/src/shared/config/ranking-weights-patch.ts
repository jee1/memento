/**
 * config/ranking-weights.toml 텍스트에 knob 변경만 반영하고 unified diff 를 만든다 (#1584).
 * TOML 을 다시 직렬화하지 않는다. 값 토큰만 바꿔야 주석과 줄 순서가 그대로 남고 diff 가 한두 줄로 끝난다.
 */

import { type KnobKey, isKnobKey } from './ranking-knobs.js';

const RANKING_WEIGHTS_REPO_PATH = 'config/ranking-weights.toml';

const CONTEXT_LINES = 3;
const SECTION_RE = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/;

export interface RankingKnobPatch {
  text: string;
  /** git apply 로 적용되는 unified diff. 변경이 없으면 빈 문자열. */
  diff: string;
}

interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
}

function decimalsOf(token: string): number {
  const dot = token.indexOf('.');
  return dot < 0 ? 0 : token.length - dot - 1;
}

/** 기존 표기의 소수 자릿수를 깨지 않는다. 0.30 → 0.25, 2.0 → 2.2, 40 → 55. */
function formatLike(oldToken: string | undefined, value: number): string {
  const natural = Number.isInteger(value) || String(value).includes('e') ? value.toFixed(0) : String(value);
  const digits = Math.max(oldToken === undefined ? 0 : decimalsOf(oldToken), decimalsOf(natural));
  return value.toFixed(Math.min(digits, 10));
}

function splitKey(key: KnobKey): [string, string] {
  const [section, field] = key.split('.') as [string, string];
  return [section, field];
}

export function applyRankingKnobChanges(
  tomlText: string,
  changes: Partial<Record<KnobKey, number>>,
): RankingKnobPatch {
  if (tomlText.length > 0 && !tomlText.endsWith('\n')) {
    throw new Error('ranking-weights.toml 이 개행으로 끝나지 않습니다');
  }
  const oldLines = tomlText.split('\n');
  oldLines.pop();

  const bySection = new Map<string, Map<string, number>>();
  for (const [key, value] of Object.entries(changes)) {
    if (!isKnobKey(key)) throw new Error(`알 수 없는 knob: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} 값이 유한한 숫자가 아닙니다`);
    const [section, field] = splitKey(key);
    bySection.set(section, (bySection.get(section) ?? new Map()).set(field, value));
  }

  // 줄마다 교체할 새 줄과, 그 줄 뒤에 끼울 줄을 모은다.
  const replaced = new Map<number, string>();
  const insertedAfter = new Map<number, string[]>();
  let section = '';
  const lastAssignment = new Map<string, number>();
  const remaining = new Map([...bySection].map(([s, fields]) => [s, new Map(fields)]));

  oldLines.forEach((line, index) => {
    const header = SECTION_RE.exec(line);
    if (header) {
      section = header[1]!.trim();
      return;
    }
    const assignment = /^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(\S+?)(\s*(?:#.*)?\r?)$/.exec(line);
    if (!assignment) return;
    lastAssignment.set(section, index);
    const [, indent, field, eq, token, tail] = assignment;
    const wanted = remaining.get(section)?.get(field!);
    if (wanted === undefined) return;
    remaining.get(section)!.delete(field!);
    replaced.set(index, `${indent}${field}${eq}${formatLike(token, wanted)}${tail}`);
  });

  const appended: string[] = [];
  for (const [sectionName, fields] of remaining) {
    if (fields.size === 0) continue;
    const lines = [...fields].map(([field, value]) => `${field} = ${formatLike(undefined, value)}`);
    const anchor = lastAssignment.get(sectionName);
    if (anchor !== undefined) {
      insertedAfter.set(anchor, [...(insertedAfter.get(anchor) ?? []), ...lines]);
    } else {
      appended.push('', `[${sectionName}]`, ...lines);
    }
  }

  const diffLines: DiffLine[] = [];
  const newLines: string[] = [];
  oldLines.forEach((line, index) => {
    const next = replaced.get(index);
    if (next === undefined) {
      diffLines.push({ kind: ' ', text: line });
      newLines.push(line);
    } else {
      diffLines.push({ kind: '-', text: line }, { kind: '+', text: next });
      newLines.push(next);
    }
    for (const added of insertedAfter.get(index) ?? []) {
      diffLines.push({ kind: '+', text: added });
      newLines.push(added);
    }
  });
  for (const added of appended) {
    diffLines.push({ kind: '+', text: added });
    newLines.push(added);
  }

  const text = newLines.length === 0 ? '' : `${newLines.join('\n')}\n`;
  return { text, diff: renderUnifiedDiff(diffLines) };
}

function renderUnifiedDiff(lines: DiffLine[]): string {
  const changed = lines.flatMap((l, i) => (l.kind === ' ' ? [] : [i]));
  if (changed.length === 0) return '';

  const ranges: Array<[number, number]> = [];
  for (const i of changed) {
    const start = Math.max(0, i - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, i + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  const out = [`--- a/${RANKING_WEIGHTS_REPO_PATH}`, `+++ b/${RANKING_WEIGHTS_REPO_PATH}`];
  for (const [start, end] of ranges) {
    const before = lines.slice(0, start);
    const oldStart = before.filter((l) => l.kind !== '+').length + 1;
    const newStart = before.filter((l) => l.kind !== '-').length + 1;
    const body = lines.slice(start, end + 1);
    const oldCount = body.filter((l) => l.kind !== '+').length;
    const newCount = body.filter((l) => l.kind !== '-').length;
    out.push(`@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`);
    for (const l of body) out.push(`${l.kind}${l.text}`);
  }
  return `${out.join('\n')}\n`;
}
