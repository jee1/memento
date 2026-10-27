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
  readonly type: 'semantic';
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
  readonly final_score: number;
}

export interface LoggedCase {
  readonly id: CaseId;
  readonly sha1: string;
  readonly text: string;
  readonly final_score: number;
}

/** 로그 줄은 `inj_id` 가 있으면 주입, `reset` 이 있으면 초기화다. */
export interface InjectionLine {
  readonly inj_id: InjId;
  readonly ts: string;
  readonly session_id: SessionId;
  readonly cwd: string;
  readonly mode: DirectiveMode;
  readonly prompt_sha1: string;
  readonly cases: readonly LoggedCase[];
  readonly candidates?: ReadonlyArray<Pick<CaseCandidate, 'id' | 'final_score'>>;
  /** 300자를 넘어 건너뛴 case id. 예산 때문에 못 고른 case 는 기록하지 않는다. */
  readonly skipped: readonly CaseId[];
  readonly fallback: boolean;
  readonly context_text: string;
  readonly pinned_skipped?: true;
}

export interface ResetLine {
  readonly session_id: SessionId;
  readonly reset: true;
  readonly ts: string;
}

export type LogLine = InjectionLine | ResetLine;
