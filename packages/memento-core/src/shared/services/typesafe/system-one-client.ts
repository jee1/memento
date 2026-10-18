/**
 * TypeSafe System One noul transport.
 * Callers own question text and what a failure means. This class only posts and parses.
 */

export type NoulQuestion = {
  readonly id: string;
  readonly instructions: string;
};

export type SystemOneState = Readonly<Record<string, string>>;

export type SystemOneFailureReason =
  | 'waf'
  | 'auth'
  | 'http'
  | 'timeout'
  | 'parse'
  | 'network';

export type SystemOneResult =
  | {
      readonly ok: true;
      readonly noulById: ReadonlyMap<string, number>;
      readonly wafRetried: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: SystemOneFailureReason;
      readonly wafRetried: boolean;
    };

const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 1500;

type PostOutcome =
  | { readonly ok: true; readonly noulById: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly reason: SystemOneFailureReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function neutralizeCodeFences(text: string): string {
  return text.replaceAll('```', '');
}

function stateHasFence(state: SystemOneState): boolean {
  return Object.values(state).some((value) => value.includes('```'));
}

function stripFences(state: SystemOneState): SystemOneState {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    next[key] = neutralizeCodeFences(value);
  }
  return next;
}

async function readResponseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function finiteNoulMap(body: unknown): ReadonlyMap<string, number> | null {
  if (!isRecord(body)) {
    return null;
  }
  const answers = body.answers;
  const scores = new Map<string, number>();
  if (!isRecord(answers)) {
    return scores;
  }
  for (const [id, answer] of Object.entries(answers)) {
    if (!isRecord(answer)) {
      continue;
    }
    const noul = answer.noul;
    if (typeof noul === 'number' && Number.isFinite(noul)) {
      scores.set(id, noul);
    }
  }
  return scores;
}

function failureReason(status: number, body: unknown): SystemOneFailureReason {
  if (status === 401 || (status === 403 && isRecord(body) && 'detail' in body)) {
    return 'auth';
  }
  if (status === 403) {
    return 'waf';
  }
  return 'http';
}

export class SystemOneClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: {
    readonly apiKey: string;
    readonly model?: string;
    readonly baseUrl?: string;
    readonly timeoutMs?: number;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model && options.model.length > 0 ? options.model : DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * One logical ask. Never throws.
   * On waf, retries once. `retryState` is the caller's second payload (the gate
   * re-clips after stripping the original text). Otherwise fences are stripped
   * from the state already sent. A body with no fence is not sent again.
   */
  async ask(
    state: SystemOneState,
    questions: readonly NoulQuestion[],
    retryState?: SystemOneState,
  ): Promise<SystemOneResult> {
    if (questions.length === 0) {
      return { ok: true, noulById: new Map(), wafRetried: false };
    }

    const first = await this.post(state, questions);
    if (first.ok) {
      return { ok: true, noulById: first.noulById, wafRetried: false };
    }
    if (first.reason !== 'waf') {
      return { ok: false, reason: first.reason, wafRetried: false };
    }

    const next = retryState ?? (stateHasFence(state) ? stripFences(state) : undefined);
    if (next === undefined) {
      return { ok: false, reason: 'waf', wafRetried: false };
    }

    const second = await this.post(next, questions);
    if (second.ok) {
      return { ok: true, noulById: second.noulById, wafRetried: true };
    }
    return { ok: false, reason: second.reason, wafRetried: true };
  }

  private async post(
    state: SystemOneState,
    questions: readonly NoulQuestion[],
  ): Promise<PostOutcome> {
    const questionBody: Record<string, { type: 'noul'; instructions: string }> = {};
    for (const question of questions) {
      questionBody[question.id] = { type: 'noul', instructions: question.instructions };
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          state,
          questions: questionBody,
        }),
        signal: controller.signal,
      });

      const body = await readResponseJson(res);
      if (!res.ok) {
        return { ok: false, reason: failureReason(res.status, body) };
      }

      const noulById = finiteNoulMap(body);
      if (noulById === null) {
        return { ok: false, reason: 'parse' };
      }
      return { ok: true, noulById };
    } catch (error) {
      const reason: SystemOneFailureReason =
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network';
      return { ok: false, reason };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
