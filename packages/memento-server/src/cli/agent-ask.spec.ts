import { describe, it, expect } from 'vitest';
import { parseAgentAskInvocation, stripGlobalCliArgs } from './agent-ask.js';

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
});
