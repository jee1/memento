import { describe, expect, it } from 'vitest';
import { detectAppLogEvent, detectDockerAnomaly, detectRuntimeAnomaly } from '../detectors.js';
import { parseAppLogLine } from '../parsers.js';

describe('detectAppLogEvent', () => {
  it('detects structured error logs immediately', () => {
    const event = detectAppLogEvent(parseAppLogLine('2026-05-02T00:00:00.000Z | ERROR | Database timeout | {"component":"db"}'));

    expect(event).toMatchObject({
      source: 'app-log',
      severity: 'error',
      title: 'App error: Database timeout',
      normalizedMessage: 'Database timeout',
    });
  });

  it('detects uncaught exceptions as critical', () => {
    const event = detectAppLogEvent(parseAppLogLine('UncaughtException: TypeError: boom'));

    expect(event?.severity).toBe('critical');
    expect(event?.title).toBe('App critical: UncaughtException: TypeError: boom');
  });
});

describe('detectRuntimeAnomaly', () => {
  it('detects scheduler error count growth', () => {
    const event = detectRuntimeAnomaly({
      type: 'runtime_sample',
      timestamp: '2026-05-02T00:00:00.000Z',
      batchScheduler: { errorCount: { sleep: 4 } },
    });

    expect(event).toMatchObject({
      source: 'app-diagnostics',
      severity: 'anomaly',
      title: 'Runtime anomaly: scheduler errors for sleep',
    });
  });
});

describe('detectDockerAnomaly', () => {
  it('detects OOMKilled inspect records', () => {
    const event = detectDockerAnomaly({
      Name: '/memento-mcp-server',
      State: { OOMKilled: true, Status: 'exited' },
    });

    expect(event).toMatchObject({
      source: 'docker-diagnostics',
      severity: 'critical',
      title: 'Docker critical: container OOMKilled',
    });
  });
});
