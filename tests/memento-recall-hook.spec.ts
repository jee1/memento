import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'plugins/memento/hooks/memento-recall.sh');

function run(host: string, mode?: string): unknown {
  const args = mode ? [script, host, mode] : [script, host];
  const stdout = execFileSync('bash', args, { encoding: 'utf8' });
  return JSON.parse(stdout);
}

describe('memento recall hook (#1447)', () => {
  it('cursor prompt JSON tells episodic writes to use record', () => {
    const output = run('cursor') as { additional_context: string; continue: boolean };
    expect(output.continue).toBe(true);
    expect(output.additional_context).toContain('record.decision');
    expect(output.additional_context).toContain('record.failed');
    expect(output.additional_context).not.toContain('안 통한 것: 실패한');
  });

  it.each(['claude', 'codex'])('%s prompt JSON uses hookSpecificOutput and record', (host) => {
    const output = run(host) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(output.hookSpecificOutput.additionalContext).toContain('record.rationale');
  });

  it('session mode stays a brief and does not require record', () => {
    const output = run('claude', 'session') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('include_project_brief');
    expect(output.hookSpecificOutput.additionalContext).not.toContain('record.decision');
  });
});
