import { mementoConfig } from '@memento/core';
import { parseArgvToParams } from '../option-map.js';

export type PreCliOptions = {
  dbPath?: string;
  envFile?: string;
  configDir?: string;
};

export type ParsedAgentAsk =
  | { kind: 'help' }
  | { kind: 'usage'; message: string }
  | {
      kind: 'run';
      userMessage: string;
      projectId?: string;
      tokenBudget?: number;
      json: boolean;
      noSave: boolean;
      jsonImplicitNoSave: boolean;
      forceLlmMock: boolean;
    };

export function stripGlobalCliArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db-path' || arg === '--env-file' || arg === '--config-dir') {
      if (argv[i + 1]) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

export function parseAgentAskInvocation(argv: string[]): ParsedAgentAsk {
  const rest = stripGlobalCliArgs(argv);
  if (rest.length === 0) {
    return { kind: 'usage', message: 'agent ask: 인자가 없습니다.' };
  }
  if (rest[0] !== 'agent') {
    return { kind: 'usage', message: 'internal: not an agent command' };
  }
  const sub = rest[1];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    return { kind: 'help' };
  }
  if (sub !== 'ask') {
    return {
      kind: 'usage',
      message: `알 수 없는 agent 서브커맨드: ${sub}. 사용: memento agent ask <message> [options]`,
    };
  }
  const tail = rest.slice(2);
  if (tail.length === 0) {
    return { kind: 'usage', message: 'agent ask: 사용자 메시지가 필요합니다.' };
  }
  if (tail[0] === '--help' || tail[0] === '-h') {
    return { kind: 'help' };
  }
  if (tail[0].startsWith('-')) {
    return {
      kind: 'usage',
      message: 'agent ask: 사용자 메시지는 ask 바로 다음에 와야 합니다(플래그 아님).',
    };
  }
  const userMessage = tail[0];
  if (!String(userMessage).trim()) {
    return { kind: 'usage', message: 'agent ask: 사용자 메시지가 비어 있습니다.' };
  }

  const flagArgv = tail.slice(1);
  if (flagArgv.includes('--help') || flagArgv.includes('-h')) {
    return { kind: 'help' };
  }

  const flagErr = validateAgentAskFlagArgv(flagArgv);
  if (flagErr) {
    return { kind: 'usage', message: flagErr };
  }

  const raw = parseArgvToParams(flagArgv);
  const typeErr = validateAgentAskRawTypes(raw);
  if (typeErr) {
    return { kind: 'usage', message: typeErr };
  }

  const json = raw.json === true;
  const noSave = raw.no_save === true;

  if (raw.llm !== undefined && raw.llm !== 'mock') {
    return {
      kind: 'usage',
      message: 'agent ask: --llm 값은 현재 mock만 지원합니다.',
    };
  }
  if (raw.llm === true) {
    return { kind: 'usage', message: 'agent ask: --llm 에는 mock 을 지정하세요.' };
  }

  return {
    kind: 'run',
    userMessage,
    projectId: typeof raw.project_id === 'string' ? raw.project_id : undefined,
    tokenBudget: typeof raw.token_budget === 'number' ? raw.token_budget : undefined,
    json,
    noSave,
    jsonImplicitNoSave: json && !noSave,
    forceLlmMock: raw.llm === 'mock',
  };
}

const AGENT_ASK_ALLOWED_FLAGS = new Set([
  'json',
  'no_save',
  'project_id',
  'token_budget',
  'llm',
]);

const AGENT_ASK_VALUE_FLAGS = new Set(['project_id', 'token_budget', 'llm']);

export function validateAgentAskFlagArgv(flagArgv: string[]): string | null {
  for (let i = 0; i < flagArgv.length; ) {
    const arg = flagArgv[i];
    if (arg === '-h' || arg === '--help') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      return `알 수 없는 인자: ${arg}`;
    }
    if (!arg.startsWith('--') || arg.length <= 2) {
      return `알 수 없는 옵션: ${arg}`;
    }
    const key = arg.slice(2).replace(/-/g, '_');
    if (!AGENT_ASK_ALLOWED_FLAGS.has(key)) {
      return `알 수 없는 옵션: --${arg.slice(2)}`;
    }
    if (AGENT_ASK_VALUE_FLAGS.has(key)) {
      const next = flagArgv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        return `옵션 --${key.replace(/_/g, '-')} 에는 값이 필요합니다.`;
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

export function validateAgentAskRawTypes(raw: Record<string, unknown>): string | null {
  if ('json' in raw && raw.json !== true) {
    return 'agent ask: --json 은 값 없이 쓰는 플래그입니다.';
  }
  if ('no_save' in raw && raw.no_save !== true) {
    return 'agent ask: --no-save 는 값 없이 쓰는 플래그입니다.';
  }
  if ('project_id' in raw) {
    if (typeof raw.project_id !== 'string' || !String(raw.project_id).trim()) {
      return 'agent ask: --project-id 는 비어 있지 않은 문자열이어야 합니다.';
    }
  }
  if ('token_budget' in raw) {
    if (typeof raw.token_budget !== 'number' || !Number.isFinite(raw.token_budget)) {
      return 'agent ask: --token-budget 는 유한한 숫자여야 합니다.';
    }
  }
  return null;
}

export function resolveDbPath(pre: PreCliOptions): string {
  const fromCli = pre.dbPath?.trim();
  if (fromCli) return fromCli;
  const fromEnv = process.env.DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  return mementoConfig.dbPath;
}

