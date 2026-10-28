import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { DIRECTIVE_POLICY } from './select.js';
import type { RecallPort, RecallRequest } from './types.js';

const MAX_FILE_BYTES = 64 * 1024;

export interface MarkdownCase {
  readonly memory_id: string;
  readonly content: string;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  const after = raw.slice(end + 4);
  return after.startsWith('\n') ? after.slice(1) : after;
}

function isCaseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed === '---') return false;
  return true;
}

export function parseMarkdownCases(raw: string, fileId: string): MarkdownCase[] {
  const body = stripFrontmatter(raw);
  const out: MarkdownCase[] = [];
  let index = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!isCaseLine(line)) continue;
    const content = oneLine(line);
    if (!content) continue;
    index += 1;
    const memory_id = createHash('sha1')
      .update(`${fileId}\0${index}\0${content}`)
      .digest('hex')
      .slice(0, 16);
    out.push({ memory_id, content });
  }
  return out;
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const part of text.toLowerCase().split(/[^\p{L}\p{N}:._/-]+/u)) {
    if (part.length >= 2) out.add(part);
  }
  return out;
}

/** case 토큰이 질의에 얼마나 등장하는지. 전부 등장하면 1, 절반이면 0.5. */
export function scoreCaseAgainstQuery(query: string, content: string): number {
  const caseTokens = tokens(content);
  if (caseTokens.size === 0) return 0;
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return 0;
  let hit = 0;
  for (const tok of caseTokens) {
    if (queryTokens.has(tok)) hit += 1;
  }
  return hit / caseTokens.size;
}

async function loadCases(dir: string, signal: AbortSignal): Promise<MarkdownCase[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const names = await readdir(dir);
  const mdNames = names.filter((name) => name.endsWith('.md')).sort();
  const cases: MarkdownCase[] = [];
  for (const name of mdNames) {
    if (signal.aborted) throw new Error('markdown recall aborted');
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await readFile(path, 'utf8');
    cases.push(...parseMarkdownCases(raw, name));
  }
  return cases;
}

/**
 * 로컬 마크다운 폴더를 읽는 RecallPort.
 * 출력 모양은 서버 recall 과 같다: `{ items: [{ memory_id, content, final_score }] }`.
 */
export function createMarkdownDirectiveRecallPort(casesDir: string): RecallPort {
  return async (request: RecallRequest, signal: AbortSignal) => {
    if (signal.aborted) throw new Error('markdown recall aborted');
    const cases = await loadCases(casesDir, signal);
    const scored = cases
      .map((item) => ({
        memory_id: item.memory_id,
        content: item.content,
        final_score: scoreCaseAgainstQuery(request.query, item.content),
      }))
      .filter((item) => item.final_score > 0)
      .sort((a, b) => b.final_score - a.final_score || a.memory_id.localeCompare(b.memory_id));
    const limit = Math.max(1, Math.min(request.limit, DIRECTIVE_POLICY.recallLimit));
    return { items: scored.slice(0, limit) };
  };
}
