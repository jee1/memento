import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_EVENT_JSON_SCHEMA,
  canonicalize,
  normalizeAgentEvent,
  validateAgentEvent,
} from './index.js';
import { eventFixture } from './test-fixtures.js';

describe('agent lifecycle envelope validation', () => {
  it.each(['SESSION_START', 'USER_PROMPT', 'TOOL_RESULT', 'PRE_COMPACT', 'STOP'] as const)(
    'accepts a valid %s event',
    (eventType) => {
      expect(validateAgentEvent(eventFixture(eventType))).toEqual({ valid: true });
    },
  );

  it('rejects unknown top-level fields', () => {
    const input = { ...eventFixture('SESSION_START'), unexpected: true };

    expect(validateAgentEvent(input)).toEqual({
      valid: false,
      reason: 'INVALID_ENVELOPE',
    });
  });

  it('rejects unsupported contract versions with a stable reason', () => {
    const input = { ...eventFixture('SESSION_START'), contract_version: 2 };

    expect(validateAgentEvent(input)).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_CONTRACT_VERSION',
    });
  });

  it('rejects invalid timestamps, identifiers, and payloads', () => {
    expect(validateAgentEvent({
      ...eventFixture('USER_PROMPT'),
      occurred_at: '2026-06-06',
    })).toEqual({ valid: false, reason: 'INVALID_ENVELOPE' });
    expect(validateAgentEvent({
      ...eventFixture('USER_PROMPT'),
      adapter_name: 'Codex Agent',
    })).toEqual({ valid: false, reason: 'INVALID_ENVELOPE' });
    expect(validateAgentEvent({
      ...eventFixture('PRE_COMPACT'),
      payload: { context_summary: 'summary', token_budget: 0 },
    })).toEqual({ valid: false, reason: 'INVALID_PAYLOAD' });
  });

  it('exports a closed draft 2020-12 JSON Schema', () => {
    expect(AGENT_EVENT_JSON_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(AGENT_EVENT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(AGENT_EVENT_JSON_SCHEMA.oneOf).toHaveLength(5);
  });
});

describe('normalization and canonicalization', () => {
  it('trims identifiers and removes undefined values without mutating input', () => {
    const input = eventFixture('SESSION_START', {
      event_id: '  evt-1  ',
      session_id: '  ses-1  ',
      scope: { owner_id: undefined, project_id: '  project-1  ' },
    });

    const normalized = normalizeAgentEvent(input);

    expect(normalized.event_id).toBe('evt-1');
    expect(normalized.session_id).toBe('ses-1');
    expect(normalized.scope).toEqual({ project_id: 'project-1' });
    expect(input.event_id).toBe('  evt-1  ');
  });

  it('serializes object keys deterministically and hashes the canonical bytes', () => {
    const left = { z: 1, nested: { b: true, a: null }, a: 'first' };
    const right = { a: 'first', nested: { a: null, b: true }, z: 1 };
    const canonical = canonicalize(left);

    expect(canonical).toEqual(canonicalize(right));
    expect(canonical.sha256).toBe(
      createHash('sha256').update(canonical.json).digest('hex'),
    );
  });

  it('rejects non-finite numbers and circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => canonicalize({ value: Number.NaN })).toThrow('INVALID_PAYLOAD');
    expect(() => canonicalize(circular)).toThrow('INVALID_PAYLOAD');
  });
});
