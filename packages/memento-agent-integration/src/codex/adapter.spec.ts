import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateAgentEvent } from '../schema.js';
import { normalizeCodexHook } from './adapter.js';

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

describe('Codex adapter', () => {
  const cases = [
    ['session-start', 'SESSION_START'],
    ['user-prompt-submit', 'USER_PROMPT'],
    ['post-tool-use', 'TOOL_RESULT'],
    ['pre-compact', 'PRE_COMPACT'],
    ['stop', 'STOP'],
  ] as const;

  it.each(cases)('replays %s as %s', (name, eventType) => {
    const event = normalizeCodexHook(fixture(name), {
      adapterVersion: '0.1.0',
      now: () => 1_780_819_200_000,
      env: {
        MEMENTO_OWNER_ID: 'owner-1',
        MEMENTO_PROJECT_ID: 'github.com/jee1/memento',
        MEMENTO_PROCESS_ID: 'issue-459',
      },
    });

    expect(event.event_type).toBe(eventType);
    expect(event.adapter_name).toBe('codex');
    expect(event.session_id).toBe('codex-session-019');
    expect(event.scope).toEqual({
      owner_id: 'owner-1',
      project_id: 'github.com/jee1/memento',
      process_id: 'issue-459',
    });
    expect(validateAgentEvent(event)).toEqual({ valid: true });
  });

  it('produces deterministic ids and rejects unsupported hooks', () => {
    const options = { adapterVersion: '0.1.0', now: () => 10, env: {} };
    expect(normalizeCodexHook(fixture('post-tool-use'), options).event_id)
      .toBe(normalizeCodexHook(fixture('post-tool-use'), options).event_id);
    expect(() => normalizeCodexHook({
      hook_event_name: 'Unknown',
      session_id: 's',
      cwd: '/tmp',
    })).toThrow(/Unsupported Codex hook/);
  });

  it('uses the stable last_assistant_message field for stop summaries', () => {
    const input = fixture('stop') as Record<string, unknown>;
    const event = normalizeCodexHook({
      ...input,
      summary: undefined,
      last_assistant_message: 'Completed from stable hook payload.',
    });

    expect(event.payload).toMatchObject({
      outcome: 'completed',
      summary: 'Completed from stable hook payload.',
    });
  });
});
