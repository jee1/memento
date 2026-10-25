import { createHash } from 'node:crypto';

import {
  caseId,
  injId,
  type CaseCandidate,
  type CaseId,
  type InjId,
  type SkippedCase,
} from './types.js';

export const DIRECTIVE_POLICY = {
  caseTag: 'case',
  caseMaxChars: 300,
  queryMaxChars: 500,
  recallLimit: 15,
  maxCases: 5,
  maxCaseBytes: 4500,
  pinnedMaxBytes: 1024,
  recallTimeoutMs: 1500,
  deadlineMs: 3500,
} as const;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function clipCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/** 서버 `recall` 결과(`{ items: [...] }`)를 해석한다. 모양이 틀리면 던진다. */
export function parseRecallItems(raw: unknown): CaseCandidate[] {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error('recall result has no items array');
  const out: CaseCandidate[] = [];
  for (const item of items as unknown[]) {
    const { memory_id: id, content } = (item ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof content !== 'string') continue;
    const text = oneLine(content);
    if (id && text) out.push({ id: caseId(id), text });
  }
  return out;
}

export interface CasePlan {
  readonly chosen: readonly CaseCandidate[];
  readonly skipped: readonly SkippedCase[];
}

export function selectCases(
  candidates: readonly CaseCandidate[],
  inContext: ReadonlySet<CaseId>,
): CasePlan {
  const chosen: CaseCandidate[] = [];
  const skipped: SkippedCase[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (chosen.length >= DIRECTIVE_POLICY.maxCases) break;
    if (inContext.has(candidate.id)) continue;
    if (codePointLength(candidate.text) > DIRECTIVE_POLICY.caseMaxChars) {
      skipped.push({ id: candidate.id, reason: 'over_length' });
      continue;
    }
    const size = Buffer.byteLength(candidate.text, 'utf8');
    if (bytes + size > DIRECTIVE_POLICY.maxCaseBytes) {
      skipped.push({ id: candidate.id, reason: 'over_budget' });
      continue;
    }
    bytes += size;
    chosen.push(candidate);
  }
  return { chosen, skipped };
}

export function makeInjId(session: string, nowMs: number, prompt: string): InjId {
  const digest = createHash('sha256').update(`${session}|${nowMs}|${prompt}`).digest('hex');
  return injId(digest.slice(0, 8));
}

export function renderContext(
  id: InjId,
  pinned: string | null,
  chosen: readonly CaseCandidate[],
  inContextAfter: readonly CaseId[],
): string {
  return [
    `[inj:${id}]`,
    ...(pinned ? [pinned] : []),
    ...chosen.map((c) => `- ${c.text}`),
    `[cases-in-context: ${inContextAfter.join(', ')}]`,
  ].join('\n');
}

export function toHookStdout(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  });
}
