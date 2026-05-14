import { describe, it, expect } from 'vitest';
import {
  parseAgentAskInvocation,
  stripGlobalCliArgs,
  validateAgentAskFlagArgv,
  validateAgentAskRawTypes,
} from './agent-ask.js';

function argv(...parts: string[]): string[] {
  return ['node', '/virtual/cli.js', ...parts];
}

describe('stripGlobalCliArgs', () => {
  it('글로벌 옵션 쌍을 제거하고 나머지 순서를 유지한다', () => {
    const a = argv(
      '--config-dir',
      '/tmp/cfg',
      'agent',
      'ask',
      'hello',
      '--json',
    );
    expect(stripGlobalCliArgs(a)).toEqual(['agent', 'ask', 'hello', '--json']);
  });
});

describe('parseAgentAskInvocation', () => {
  it('agent ask <msg> --json --no-save', () => {
    const p = parseAgentAskInvocation(
      argv('agent', 'ask', 'hello world', '--json', '--no-save'),
    );
    expect(p.kind).toBe('run');
    if (p.kind === 'run') {
      expect(p.userMessage).toBe('hello world');
      expect(p.json).toBe(true);
      expect(p.noSave).toBe(true);
      expect(p.jsonImplicitNoSave).toBe(false);
    }
  });

  it('--json 단독이면 jsonImplicitNoSave', () => {
    const p = parseAgentAskInvocation(argv('agent', 'ask', 'x', '--json'));
    expect(p.kind).toBe('run');
    if (p.kind === 'run') {
      expect(p.jsonImplicitNoSave).toBe(true);
    }
  });

  it('메시지 없으면 usage', () => {
    const p = parseAgentAskInvocation(argv('agent', 'ask'));
    expect(p.kind).toBe('usage');
  });

  it('플래그가 메시지 자리면 usage', () => {
    const p = parseAgentAskInvocation(argv('agent', 'ask', '--json'));
    expect(p.kind).toBe('usage');
  });

  it('ask --help 은 help', () => {
    const p = parseAgentAskInvocation(argv('agent', 'ask', '--help'));
    expect(p.kind).toBe('help');
  });

  it('--llm openai 는 usage', () => {
    const p = parseAgentAskInvocation(
      argv('agent', 'ask', 'm', '--llm', 'openai'),
    );
    expect(p.kind).toBe('usage');
  });

  it('알 수 없는 agent 서브커맨드', () => {
    const p = parseAgentAskInvocation(argv('agent', 'foo'));
    expect(p.kind).toBe('usage');
    if (p.kind === 'usage') {
      expect(p.message).toContain('foo');
    }
  });

  it('알 수 없는 옵션은 usage (exit 1 경로)', () => {
    const p = parseAgentAskInvocation(
      argv('agent', 'ask', 'hi', '--json', '--bogus', 'nope'),
    );
    expect(p.kind).toBe('usage');
    if (p.kind === 'usage') {
      expect(p.message).toContain('bogus');
    }
  });

  it('--token-budget 값 없으면 usage', () => {
    const p = parseAgentAskInvocation(
      argv('agent', 'ask', 'hi', '--token-budget', '--json'),
    );
    expect(p.kind).toBe('usage');
  });

  it('--json 뒤에 남는 토큰이 있으면 usage', () => {
    const p = parseAgentAskInvocation(argv('agent', 'ask', 'hi', '--json', 'orphan'));
    expect(p.kind).toBe('usage');
  });

  it('--token-bduget 처럼 오타는 알 수 없는 옵션', () => {
    const p = parseAgentAskInvocation(
      argv('agent', 'ask', 'hi', '--token-bduget', '100'),
    );
    expect(p.kind).toBe('usage');
    if (p.kind === 'usage') {
      expect(p.message).toMatch(/token-bduget|알 수 없는/);
    }
  });
});

describe('validateAgentAskFlagArgv', () => {
  it('허용 플래그만 통과', () => {
    expect(
      validateAgentAskFlagArgv([
        '--json',
        '--no-save',
        '--project-id',
        'p1',
        '--token-budget',
        '500',
        '--llm',
        'mock',
      ]),
    ).toBeNull();
  });
});

describe('validateAgentAskRawTypes', () => {
  it('--json 에 잘못된 값 타입 거절', () => {
    expect(validateAgentAskRawTypes({ json: 'yes' })).not.toBeNull();
  });
});
