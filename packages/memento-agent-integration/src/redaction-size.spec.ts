import { describe, expect, it } from 'vitest';
import {
  applySizePolicy,
  buildBatch,
  redactAgentEvent,
  utf8Size,
  validateBatch,
} from './index.js';
import { eventFixture } from './test-fixtures.js';

describe('fail-closed redaction', () => {
  it('redacts key-based secrets, inline credentials, email, phone, and high-entropy secrets', () => {
    const rawSecrets = [
      ['sk', 'live', '123456789012345678901234'].join('_'),
      'person@example.com',
      '+1 (415) 555-2671',
      'A9f3K2mP8qR4sT7vW1xY6zB0cD5eF9gH',
    ];
    const input = eventFixture('TOOL_RESULT', {
      payload: {
        tool_name: 'exec_command',
        outcome: 'error',
        input: {
          api_key: rawSecrets[0],
          command: `login person@example.com +1 (415) 555-2671 ${rawSecrets[3]}`,
        },
      },
    });

    const result = redactAgentEvent(input);
    const serialized = JSON.stringify(result);

    expect(result.action).toBe('REDACTED');
    expect(result.metadata).toEqual(expect.arrayContaining([
      { rule: 'API_KEY', count: 1 },
      { rule: 'EMAIL', count: 1 },
      { rule: 'PHONE', count: 1 },
      { rule: 'HIGH_ENTROPY_SECRET', count: 1 },
    ]));
    for (const secret of rawSecrets) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('redacts OpenAI-style hyphenated API keys embedded in text', () => {
    const rawSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const result = redactAgentEvent(eventFixture('USER_PROMPT', {
      payload: {
        content: `Use ${rawSecret} for the request`,
        content_format: 'text',
      },
    }));

    expect(result.action).toBe('REDACTED');
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(result.metadata).toContainEqual({ rule: 'API_KEY', count: 1 });
  });

  it('drops an observation containing private key material without echoing it', () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nraw-private-material\n-----END PRIVATE KEY-----';

    const result = redactAgentEvent(eventFixture('STOP', {
      payload: { outcome: 'failed', error: privateKey },
    }));

    expect(result).toEqual({
      action: 'DROPPED',
      reason: 'PRIVATE_KEY_MATERIAL',
      metadata: [{ rule: 'PRIVATE_KEY_MATERIAL', count: 1 }],
    });
    expect(JSON.stringify(result)).not.toContain('raw-private-material');
  });

  it('drops sensitive path and binary content observations fail-closed', () => {
    expect(redactAgentEvent(eventFixture('TOOL_RESULT', {
      payload: {
        tool_name: 'read',
        outcome: 'success',
        input: { path: '/home/user/.ssh/id_rsa' },
        output: { content: 'secret' },
      },
    }))).toEqual({
      action: 'DROPPED',
      reason: 'SENSITIVE_PATH',
      metadata: [{ rule: 'SENSITIVE_PATH', count: 1 }],
    });

    expect(redactAgentEvent(eventFixture('TOOL_RESULT', {
      payload: {
        tool_name: 'read',
        outcome: 'success',
        output: { content: 'abc\u0000def' },
      },
    }))).toEqual({
      action: 'DROPPED',
      reason: 'BINARY_CONTENT',
      metadata: [{ rule: 'BINARY_CONTENT', count: 1 }],
    });
  });
});

describe('deterministic size and batch policy', () => {
  it('accepts an event below 32KiB unchanged', () => {
    const event = eventFixture('USER_PROMPT');

    expect(applySizePolicy(event)).toEqual({
      action: 'ACCEPTED',
      event,
      bytes: utf8Size(event),
    });
  });

  it('deterministically reduces oversized optional content while preserving required fields', () => {
    const event = eventFixture('TOOL_RESULT', {
      payload: {
        tool_name: 'exec_command',
        outcome: 'error',
        input: { command: `npm test ${'i'.repeat(20_000)}` },
        output: {
          summary: 'failed',
          content: 'o'.repeat(40_000),
        },
        file_changes: Array.from({ length: 500 }, (_, index) => `file-${index}.ts`),
      },
    });

    const first = applySizePolicy(event);
    const second = applySizePolicy(event);

    expect(first).toEqual(second);
    expect(first.action).toBe('REDUCED');
    if (first.action === 'REDUCED') {
      expect(first.bytes).toBeLessThanOrEqual(32 * 1024);
      expect(first.event.payload).toMatchObject({
        tool_name: 'exec_command',
        outcome: 'error',
      });
    }
  });

  it('drops an irreducibly oversized event', () => {
    const event = eventFixture('TOOL_RESULT', {
      payload: {
        tool_name: 't'.repeat(40_000),
        outcome: 'error',
      },
    });

    expect(applySizePolicy(event)).toEqual({
      action: 'DROPPED',
      reason: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('limits batches to 50 events and 512KiB', () => {
    const events = Array.from({ length: 51 }, (_, index) =>
      eventFixture('USER_PROMPT', { event_id: `evt-${index}` }));

    const byCount = buildBatch(events);
    expect(byCount.events).toHaveLength(50);
    expect(byCount.remaining).toHaveLength(1);
    expect(byCount.bytes).toBeLessThanOrEqual(512 * 1024);

    const largeEvents = Array.from({ length: 20 }, (_, index) =>
      eventFixture('USER_PROMPT', {
        event_id: `large-${index}`,
        payload: { content: 'x'.repeat(30_000), content_format: 'text' },
      }));
    const byBytes = buildBatch(largeEvents);
    expect(byBytes.events.length).toBeLessThan(20);
    expect(byBytes.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(byBytes.remaining.length).toBeGreaterThan(0);
  });

  it('rejects externally supplied batches over either limit', () => {
    const tooMany = Array.from({ length: 51 }, (_, index) =>
      eventFixture('USER_PROMPT', { event_id: `evt-${index}` }));
    const tooLarge = Array.from({ length: 20 }, (_, index) =>
      eventFixture('USER_PROMPT', {
        event_id: `large-${index}`,
        payload: { content: 'x'.repeat(30_000), content_format: 'text' },
      }));

    expect(validateBatch(tooMany)).toEqual({
      valid: false,
      reason: 'BATCH_TOO_LARGE',
    });
    expect(validateBatch(tooLarge)).toEqual({
      valid: false,
      reason: 'BATCH_TOO_LARGE',
    });
    expect(validateBatch(tooMany.slice(0, 1))).toEqual({ valid: true });
  });
});
