import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeClaudeCodeHook } from './adapter.js';
import { validateAgentEvent } from '../schema.js';

const fixtureUrl = (name: string) =>
  new URL(`./fixtures/${name}.json`, import.meta.url);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(fixtureUrl(name)), 'utf8'));
}

describe('Claude Code adapter', () => {
  const cases = [
    ['session-start', 'SESSION_START'],
    ['user-prompt-submit', 'USER_PROMPT'],
    ['post-tool-use', 'TOOL_RESULT'],
    ['pre-compact', 'PRE_COMPACT'],
    ['stop', 'STOP'],
  ] as const;

  it.each(cases)('replays %s as %s', (name, expectedType) => {
    const event = normalizeClaudeCodeHook(fixture(name), {
      adapterVersion: '0.1.0',
      now: () => 1_780_819_200_000,
      env: {
        MEMENTO_OWNER_ID: 'owner-1',
        MEMENTO_PROJECT_ID: 'github.com/jee1/memento',
        MEMENTO_PROCESS_ID: 'issue-457',
      },
    });

    expect(event.event_type).toBe(expectedType);
    expect(event.session_id).toBe('claude-session-018');
    expect(event.adapter_name).toBe('claude-code');
    expect(event.sequence_no).toBe(1_780_819_200_000);
    expect(event.scope).toEqual({
      owner_id: 'owner-1',
      project_id: 'github.com/jee1/memento',
      process_id: 'issue-457',
    });
    expect(validateAgentEvent(event)).toEqual({ valid: true });
  });

  it('creates a deterministic event id for fixture replay', () => {
    const options = {
      adapterVersion: '0.1.0',
      now: () => 1_780_819_200_000,
      env: {},
    };

    expect(normalizeClaudeCodeHook(fixture('post-tool-use'), options).event_id)
      .toBe(normalizeClaudeCodeHook(fixture('post-tool-use'), options).event_id);
  });

  it('maps tool file paths and compact/stop extensions', () => {
    const tool = normalizeClaudeCodeHook(fixture('post-tool-use'));
    const compact = normalizeClaudeCodeHook(fixture('pre-compact'));
    const stop = normalizeClaudeCodeHook(fixture('stop'));

    expect(tool.payload).toMatchObject({
      tool_name: 'Write',
      outcome: 'success',
      file_changes: ['/workspace/memento/packages/example.ts'],
    });
    expect(compact.payload).toMatchObject({
      context_summary: 'Preserve adapter decisions',
      extensions: { trigger: 'manual' },
    });
    expect(stop.payload).toMatchObject({
      outcome: 'completed',
      summary: 'Adapter implementation complete.',
      extensions: {
        stop_hook_active: false,
        background_tasks: [],
        session_crons: [],
      },
    });
  });

  it('preserves an explicit failed stop outcome and error', () => {
    const input = fixture('stop') as Record<string, unknown>;
    const event = normalizeClaudeCodeHook({
      ...input,
      outcome: 'failed',
      error: { message: 'hook failed' },
    });

    expect(event.payload).toMatchObject({
      outcome: 'failed',
      error: { message: 'hook failed' },
    });
  });

  it('rejects unknown hooks', () => {
    expect(() => normalizeClaudeCodeHook({
      session_id: 'session',
      cwd: '/tmp',
      hook_event_name: 'UnknownHook',
    })).toThrow(/Unsupported Claude Code hook/);
  });
});
