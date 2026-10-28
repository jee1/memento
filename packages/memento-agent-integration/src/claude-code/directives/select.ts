import { createHash } from 'node:crypto';

import {
  caseId,
  injId,
  type CaseCandidate,
  type CaseId,
  type InjId,
} from './types.js';

export const DIRECTIVE_POLICY = {
  caseTag: 'case',
  minFinalScore: 0.5,
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
    const { memory_id: id, content, final_score } = (item ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof content !== 'string') continue;
    if (typeof final_score !== 'number' || !Number.isFinite(final_score)) continue;
    const text = oneLine(content);
    if (id && text) out.push({ id: caseId(id), text, final_score });
  }
  return out;
}

export interface CasePlan {
  readonly chosen: readonly CaseCandidate[];
  readonly skipped: readonly CaseId[];
}

export function selectCases(
  candidates: readonly CaseCandidate[],
  inContext: ReadonlySet<CaseId>,
): CasePlan {
  const chosen: CaseCandidate[] = [];
  const skipped: CaseId[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (chosen.length >= DIRECTIVE_POLICY.maxCases) break;
    if (candidate.final_score < DIRECTIVE_POLICY.minFinalScore) continue;
    if (inContext.has(candidate.id)) continue;
    if (codePointLength(candidate.text) > DIRECTIVE_POLICY.caseMaxChars) {
      skipped.push(candidate.id);
      continue;
    }
    const size = Buffer.byteLength(candidate.text, 'utf8');
    if (bytes + size > DIRECTIVE_POLICY.maxCaseBytes) continue;
    bytes += size;
    chosen.push(candidate);
  }
  return { chosen, skipped };
}

export const sha1Hex = (text: string): string => createHash('sha1').update(text).digest('hex');

export function makeInjId(session: string, nowMs: number, prompt: string): InjId {
  return injId(`${session.slice(0, 8)}-${nowMs}-${sha1Hex(prompt).slice(0, 6)}`);
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

/** Cursor `beforeSubmitPrompt` 네이티브 스키마. */
export function toCursorHookStdout(context: string): string {
  return JSON.stringify({ additional_context: context, continue: true });
}
