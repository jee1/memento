import { describe, expect, it } from 'vitest';
import { parseAppLogLine, parseJsonlRecord } from '../parsers.js';

describe('parseAppLogLine', () => {
  it('parses structured Memento log lines', () => {
    const raw = '2026-05-02T01:02:03.000Z | ERROR | DB failed | {"component":"db","requestId":"req_123"}';
    const parsed = parseAppLogLine(raw);

    expect(parsed).toEqual({
      timestamp: '2026-05-02T01:02:03.000Z',
      level: 'error',
      message: 'DB failed',
      metadata: { component: 'db', requestId: 'req_123' },
      raw,
    });
  });

  it('preserves malformed structured metadata as a parse error marker', () => {
    const parsed = parseAppLogLine('2026-05-02T01:02:03.000Z | WARN | Cache failed | {bad');

    expect(parsed.metadata).toEqual({ metadataParseError: '{bad' });
  });

  it('falls back to raw log lines', () => {
    const parsed = parseAppLogLine('UnhandledPromiseRejection: boom');

    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('UnhandledPromiseRejection: boom');
    expect(parsed.metadata).toEqual({});
  });
});

describe('parseJsonlRecord', () => {
  it('parses JSON objects', () => {
    expect(parseJsonlRecord('{"type":"runtime_sample","uptime":10}')).toEqual({
      ok: true,
      value: { type: 'runtime_sample', uptime: 10 },
    });
  });

  it('returns a recoverable error for malformed JSON', () => {
    const parsed = parseJsonlRecord('{bad');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.raw).toBe('{bad');
      expect(parsed.error).toEqual(expect.any(String));
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-object JSON records', () => {
    const parsed = parseJsonlRecord('[]');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toBe('JSONL record must be an object');
    }
  });
});
