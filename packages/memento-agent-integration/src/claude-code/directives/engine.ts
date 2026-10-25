import { readFile } from 'node:fs/promises';

import { appendLine, readInContext } from './log.js';
import {
  clipCodePoints,
  DIRECTIVE_POLICY,
  makeInjId,
  parseRecallItems,
  renderContext,
  selectCases,
  toHookStdout,
} from './select.js';
import {
  sessionId,
  type CaseCandidate,
  type DirectiveDeps,
  type DirectiveRunInput,
  type InjectionLine,
} from './types.js';

interface Pinned {
  readonly text: string | null;
  readonly skipped: boolean;
}

async function readPinned(file: string | null): Promise<Pinned> {
  if (!file) return { text: null, skipped: false };
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > DIRECTIVE_POLICY.pinnedMaxBytes) {
      return { text: null, skipped: true };
    }
    return { text: raw.trim() || null, skipped: false };
  } catch {
    return { text: null, skipped: true };
  }
}

/**
 * UserPromptSubmit 에 붙일 hook stdout 을 돌려준다. 절대 reject 하지 않는다.
 * 불변식: 로그 줄을 먼저 쓴 뒤에만 stdout 을 돌려주고, 쓰기에 실패하면 ''.
 */
export async function runDirectives(
  input: DirectiveRunInput,
  deps: DirectiveDeps,
): Promise<string> {
  try {
    return await run(input, deps);
  } catch {
    return '';
  }
}

async function run(input: DirectiveRunInput, deps: DirectiveDeps): Promise<string> {
  const { config, recall, now } = deps;
  if (!config.enabled) return '';
  const session = sessionId(input.sessionId);

  if (input.eventType === 'PRE_COMPACT') {
    await appendLine(config.logDir, { kind: 'reset', ts: now(), session_id: session }, now())
      .catch(() => undefined);
    return '';
  }
  if (input.eventType !== 'USER_PROMPT') return '';

  const startedAt = now();
  const id = makeInjId(input.sessionId, startedAt, input.prompt);
  const base = { kind: 'injection', session_id: session, inj_id: id, mode: config.mode } as const;
  const fallbackLine: InjectionLine = {
    ...base, ts: startedAt, fallback: true, cases: [], skipped: [], context_text: '',
  };

  // 마감과 작업 경로가 같은 줄을 두 번 쓰지 못하게 먼저 잡은 쪽이 이긴다.
  let owner: 'work' | 'fallback' | null = null;
  const claim = (who: 'work' | 'fallback'): boolean => (owner === null ? ((owner = who), true) : false);

  const work = async (): Promise<string> => {
    if (!recall) throw new Error('SERVER_UNAVAILABLE');
    const query = clipCodePoints(input.prompt, DIRECTIVE_POLICY.queryMaxChars);
    const fetchCandidates = async (): Promise<CaseCandidate[]> => {
      if (!query.trim()) return [];
      const raw = await recall(
        { query, tags: [DIRECTIVE_POLICY.caseTag], limit: DIRECTIVE_POLICY.recallLimit },
        AbortSignal.timeout(DIRECTIVE_POLICY.recallTimeoutMs),
      );
      return parseRecallItems(raw);
    };
    const [candidates, inContext, pinned] = await Promise.all([
      fetchCandidates(),
      readInContext(config.logDir, input.sessionId, config.mode, startedAt),
      readPinned(config.pinnedFile),
    ]);
    const plan = selectCases(candidates, inContext);
    const inContextAfter = [...inContext, ...plan.chosen.map((c) => c.id)];
    const context = renderContext(id, pinned.text, plan.chosen, inContextAfter);
    if (!claim('work')) return '';
    try {
      await appendLine(config.logDir, {
        ...base,
        ts: now(),
        fallback: false,
        cases: plan.chosen.map((c) => c.id),
        skipped: plan.skipped,
        context_text: context,
        ...(pinned.skipped ? { pinned_skipped: true as const } : {}),
      }, now());
    } catch {
      return '';
    }
    return config.mode === 'live' ? toHookStdout(context) : '';
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => { if (claim('fallback')) resolve(''); }, DIRECTIVE_POLICY.deadlineMs);
  });
  let stdout = '';
  try {
    stdout = await Promise.race([work(), deadline]);
  } catch {
    claim('fallback');
  } finally {
    clearTimeout(timer);
  }
  if (owner === 'fallback') {
    await appendLine(config.logDir, fallbackLine, now()).catch(() => undefined);
  }
  return stdout;
}
