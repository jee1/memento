import type { AgentEventEnvelope } from '../../types.js';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CaseId = Brand<string, 'CaseId'>;
export type InjId = Brand<string, 'InjId'>;
export type SessionId = Brand<string, 'SessionId'>;

export const caseId = (value: string): CaseId => value as CaseId;
export const injId = (value: string): InjId => value as InjId;
export const sessionId = (value: string): SessionId => value as SessionId;

export type DirectiveMode = 'live' | 'shadow';

export type DirectiveConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly mode: DirectiveMode;
      readonly pinnedFile: string | null;
      readonly logDir: string;
    };

export interface RecallRequest {
  readonly query: string;
  readonly tags: readonly string[];
  readonly limit: number;
}

/** 서버 `recall` 도구의 `result` 원본을 그대로 돌려준다. 해석은 select.ts 가 한다. */
export type RecallPort = (request: RecallRequest, signal: AbortSignal) => Promise<unknown>;

export interface DirectiveDeps {
  readonly config: DirectiveConfig;
  readonly recall: RecallPort | null;
  readonly now: () => number;
}

export interface DirectiveRunInput {
  readonly eventType: AgentEventEnvelope['event_type'];
  readonly sessionId: string;
  readonly cwd: string;
  readonly prompt: string;
}

export interface CaseCandidate {
  readonly id: CaseId;
  readonly text: string;
}

export type SkipReason = 'over_length' | 'over_budget';

export interface SkippedCase {
  readonly id: CaseId;
  readonly reason: SkipReason;
}

export interface InjectionLine {
  readonly kind: 'injection';
  readonly ts: number;
  readonly session_id: SessionId;
  readonly inj_id: InjId;
  readonly mode: DirectiveMode;
  readonly fallback: boolean;
  readonly cases: readonly CaseId[];
  readonly skipped: readonly SkippedCase[];
  readonly context_text: string;
  readonly pinned_skipped?: true;
}

export interface ResetLine {
  readonly kind: 'reset';
  readonly ts: number;
  readonly session_id: SessionId;
}

export type LogLine = InjectionLine | ResetLine;
