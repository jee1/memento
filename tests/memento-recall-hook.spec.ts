import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'plugins/memento/hooks/memento-recall.sh');

function runRaw(host: string, mode?: string, input = ''): string {
  const args = mode ? [script, host, mode] : [script, host];
  return execFileSync('bash', args, { encoding: 'utf8', input });
}

function run(host: string, mode?: string): unknown {
  return JSON.parse(runRaw(host, mode));
}

const promptInput = (prompt: string): string => JSON.stringify({ prompt });

describe('memento recall hook (#1447)', () => {
  it('cursor prompt JSON tells episodic writes to use record', () => {
    const output = run('cursor') as { additional_context: string; continue: boolean };
    expect(output.continue).toBe(true);
    expect(output.additional_context).toContain('record.decision');
    expect(output.additional_context).toContain('record.failed');
    expect(output.additional_context).not.toContain('안 통한 것: 실패한');
    expect(output.additional_context).toContain('핵심 낱말');
  });

  it('claude prompt JSON carries one line instead of the record guide (#1770)', () => {
    const output = run('claude') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    const context = output.hookSpecificOutput.additionalContext;
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(context).toContain('mcp__memento__memory_injection');
    expect(context).toContain('핵심 낱말');
    expect(context).not.toContain('record.decision');
    expect(context.length).toBeLessThan(400);
  });

  it('codex prompt JSON keeps the full record guide', () => {
    const output = run('codex') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(output.hookSpecificOutput.additionalContext).toContain('record.rationale');
    expect(output.hookSpecificOutput.additionalContext).toContain('핵심 낱말');
  });

  it('claude session mode adds the brief and the full guide for the whole session (#1770)', () => {
    const output = run('claude', 'session') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    const context = output.hookSpecificOutput.additionalContext;
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(context).toContain('include_project_brief');
    expect(context).toContain('record.decision');
    expect(context).toContain('이 세션의 모든 요청에서');
    expect(context).not.toContain('이번 요청을 처리하기 전에');
  });

  it('codex session mode stays a brief and does not require record', () => {
    const output = run('codex', 'session') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('include_project_brief');
    expect(output.hookSpecificOutput.additionalContext).not.toContain('record.decision');
  });

  it('no host still tells the agent to prefer sentences over keywords', () => {
    for (const [host, mode] of [['claude'], ['codex'], ['cursor'], ['claude', 'session']] as const) {
      expect(JSON.stringify(run(host, mode))).not.toContain('키워드 나열보다');
    }
  });
});

describe('memento recall hook on machine notification turns (#1770)', () => {
  const notifications = [
    '<task-notification>\n<task-id>a1</task-id>',
    '[SYSTEM NOTIFICATION - NOT USER INPUT]\nbackground task finished',
    '<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]',
    '  \n<task-notification>',
    `<task-notification>${'x'.repeat(300_000)}`,
  ];

  it.each(notifications)('claude prompt mode prints nothing for notification %#', (prompt) => {
    expect(runRaw('claude', undefined, promptInput(prompt))).toBe('');
  });

  it.each([
    promptInput('릴리스 준비해줘'),
    promptInput('로그에 <task-notification> 이 왜 찍히지?'),
    promptInput('붙여 넣은 로그:\n<task-notification>'),
    promptInput('<system-reminder>\n오늘 날짜가 바뀌었다'),
    JSON.stringify({ session_id: 's' }),
    JSON.stringify({ prompt: 1 }),
    '[]',
    '{broken',
  ])('claude prompt mode keeps the one line for input %#', (input) => {
    expect(runRaw('claude', undefined, input)).toBe(runRaw('claude'));
  });

  it.each([['claude', 'session'], ['codex', 'prompt'], ['codex', 'session'], ['cursor', 'prompt']] as const)(
    '%s %s ignores the notification check',
    (host, mode) => {
      expect(runRaw(host, mode, promptInput('<task-notification>'))).toBe(runRaw(host, mode));
    },
  );

  it.each(['claude', 'codex', 'cursor'])('%s still prints the guide when stdin is closed', (host) => {
    const stdout = execFileSync('bash', ['-c', 'bash "$1" "$2" <&-', 'closed', script, host], { encoding: 'utf8' });
    expect(stdout).toBe(runRaw(host));
  });
});
