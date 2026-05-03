# Log Issue Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in Docker log monitor that records detected Memento runtime errors locally and creates or updates GitHub Issues for severe or recurring fingerprints.

**Architecture:** Implement the monitor as focused TypeScript modules under `scripts/log-issue-monitor/`, with pure parsers/detectors first, then state persistence, then GitHub sync, then the long-running entrypoint. Add a dedicated Dockerfile and compose overlay so the process runs separately from `memento-mcp-server` and remains opt-in.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Docker Compose, Docker CLI, GitHub REST API via Node `fetch`, existing `PIIMasker` from `@memento/core` source.

---

## File Structure

Create these files:

- `scripts/log-issue-monitor/types.ts`: shared monitor types, config type, source/severity/status unions.
- `scripts/log-issue-monitor/config.ts`: environment parsing with defaults.
- `scripts/log-issue-monitor/parsers.ts`: app log and JSONL parsing.
- `scripts/log-issue-monitor/detectors.ts`: app, runtime diagnostics, and Docker diagnostics event detection.
- `scripts/log-issue-monitor/fingerprint.ts`: message normalization and fingerprint hashing.
- `scripts/log-issue-monitor/sanitizer.ts`: excerpt length limiting and PII masking.
- `scripts/log-issue-monitor/state-store.ts`: atomic local state read/write and occurrence append.
- `scripts/log-issue-monitor/github-client.ts`: GitHub search/create/update/fetch methods.
- `scripts/log-issue-monitor/issue-body.ts`: managed issue body rendering and replacement.
- `scripts/log-issue-monitor/promotion.ts`: immediate vs threshold-based GitHub promotion.
- `scripts/log-issue-monitor/sources.ts`: Docker logs and file source cursor readers.
- `scripts/log-issue-monitor/monitor.ts`: one scan/sync cycle and loop orchestration.
- `scripts/log-issue-monitor/index.ts`: CLI entrypoint.
- `scripts/log-issue-monitor/__tests__/*.spec.ts`: focused unit tests.
- `docker/log-issue-monitor/Dockerfile`: Node 24 + Docker CLI monitor image.
- `docker-compose.issue-monitor.yml`: opt-in service overlay.
- `docs/operations/ko/log-issue-monitor.md`: Korean operations guide.
- `docs/operations/en/log-issue-monitor.md`: English operations guide.

Modify these files:

- `package.json`: add `ops:log-issue-monitor` and `test:log-issue-monitor` scripts.
- `README.md`: add a short link to the operations guide.

Do not modify existing application runtime code in `packages/memento-core` or `packages/memento-server` for the MVP.

## Task 1: Types and Config

**Files:**
- Create: `scripts/log-issue-monitor/types.ts`
- Create: `scripts/log-issue-monitor/config.ts`
- Test: `scripts/log-issue-monitor/__tests__/config.spec.ts`

- [ ] **Step 1: Write failing config tests**

Create `scripts/log-issue-monitor/__tests__/config.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { loadMonitorConfig } from '../config.js';

describe('loadMonitorConfig', () => {
  it('uses safe defaults when optional environment variables are absent', () => {
    const config = loadMonitorConfig({});

    expect(config.containerName).toBe('memento-mcp-server');
    expect(config.githubRepository).toBe('jee1lee/memento');
    expect(config.intervalSeconds).toBe(30);
    expect(config.warnThreshold).toBe(3);
    expect(config.warnWindowSeconds).toBe(600);
    expect(config.dryRun).toBe(false);
    expect(config.labels).toEqual(['bug', 'needs-triage', 'memento-log-monitor']);
    expect(config.logsRoot).toBe('/logs');
    expect(config.stateDir).toBe('/logs/log-issue-monitor');
  });

  it('parses overrides and treats missing GitHub token as local-only capable', () => {
    const config = loadMonitorConfig({
      GITHUB_TOKEN: '',
      GITHUB_REPOSITORY: 'owner/repo',
      LOG_ISSUE_MONITOR_INTERVAL_SECONDS: '45',
      LOG_ISSUE_MONITOR_WARN_THRESHOLD: '5',
      LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS: '900',
      LOG_ISSUE_MONITOR_DRY_RUN: 'true',
      LOG_ISSUE_MONITOR_LABELS: 'bug,ops,monitor',
      LOG_ISSUE_MONITOR_LOGS_ROOT: '/tmp/logs',
      LOG_ISSUE_MONITOR_STATE_DIR: '/tmp/state',
      LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES: '1234',
      LOG_ISSUE_MONITOR_INCLUDE_STACK: 'false',
    });

    expect(config.githubToken).toBeUndefined();
    expect(config.githubRepository).toBe('owner/repo');
    expect(config.intervalSeconds).toBe(45);
    expect(config.warnThreshold).toBe(5);
    expect(config.warnWindowSeconds).toBe(900);
    expect(config.dryRun).toBe(true);
    expect(config.labels).toEqual(['bug', 'ops', 'monitor']);
    expect(config.logsRoot).toBe('/tmp/logs');
    expect(config.stateDir).toBe('/tmp/state');
    expect(config.maxExcerptBytes).toBe(1234);
    expect(config.includeStack).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/config.spec.ts
```

Expected: FAIL because `scripts/log-issue-monitor/config.ts` does not exist.

- [ ] **Step 3: Create shared types**

Create `scripts/log-issue-monitor/types.ts`:

```typescript
export type LogIssueSource = 'app-log' | 'app-diagnostics' | 'docker-diagnostics';
export type LogIssueSeverity = 'critical' | 'error' | 'warn' | 'anomaly';
export type FingerprintStatus = 'local_only' | 'opened' | 'closed_remote' | 'sync_failed' | 'suppressed';

export interface MonitorConfig {
  containerName: string;
  logsRoot: string;
  stateDir: string;
  githubToken?: string;
  githubRepository: string;
  intervalSeconds: number;
  warnThreshold: number;
  warnWindowSeconds: number;
  dryRun: boolean;
  labels: string[];
  maxExcerptBytes: number;
  includeStack: boolean;
}

export interface LogIssueOccurrence {
  fingerprint: string;
  source: LogIssueSource;
  severity: LogIssueSeverity;
  title: string;
  normalizedMessage: string;
  excerpt: string;
  observedAt: string;
  context: Record<string, unknown>;
}

export interface RecentOccurrence {
  observedAt: string;
  excerpt: string;
  context: Record<string, unknown>;
}

export interface LogIssueFingerprintState {
  fingerprint: string;
  source: LogIssueSource;
  severity: LogIssueSeverity;
  normalizedTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  recentOccurrences: RecentOccurrence[];
  githubIssueNumber?: number;
  status: FingerprintStatus;
  lastSyncError?: string;
}

export interface LogIssueState {
  version: 1;
  cursors: Record<string, unknown>;
  fingerprints: Record<string, LogIssueFingerprintState>;
}
```

- [ ] **Step 4: Implement config loader**

Create `scripts/log-issue-monitor/config.ts`:

```typescript
import type { MonitorConfig } from './types.js';

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function labelsFromEnv(value: string | undefined): string[] {
  const labels = value?.split(',').map(label => label.trim()).filter(Boolean);
  return labels && labels.length > 0 ? labels : ['bug', 'needs-triage', 'memento-log-monitor'];
}

export function loadMonitorConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const logsRoot = optionalString(env.LOG_ISSUE_MONITOR_LOGS_ROOT) ?? '/logs';
  return {
    containerName: optionalString(env.LOG_ISSUE_MONITOR_CONTAINER_NAME) ?? 'memento-mcp-server',
    logsRoot,
    stateDir: optionalString(env.LOG_ISSUE_MONITOR_STATE_DIR) ?? `${logsRoot}/log-issue-monitor`,
    githubToken: optionalString(env.GITHUB_TOKEN),
    githubRepository: optionalString(env.GITHUB_REPOSITORY) ?? 'jee1lee/memento',
    intervalSeconds: numberFromEnv(env.LOG_ISSUE_MONITOR_INTERVAL_SECONDS, 30),
    warnThreshold: numberFromEnv(env.LOG_ISSUE_MONITOR_WARN_THRESHOLD, 3),
    warnWindowSeconds: numberFromEnv(env.LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS, 600),
    dryRun: booleanFromEnv(env.LOG_ISSUE_MONITOR_DRY_RUN, false),
    labels: labelsFromEnv(env.LOG_ISSUE_MONITOR_LABELS),
    maxExcerptBytes: numberFromEnv(env.LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES, 6000),
    includeStack: booleanFromEnv(env.LOG_ISSUE_MONITOR_INCLUDE_STACK, true),
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/config.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/types.ts scripts/log-issue-monitor/config.ts scripts/log-issue-monitor/__tests__/config.spec.ts
git commit -m "feat(ops): add log issue monitor config"
```

## Task 2: Parsers

**Files:**
- Create: `scripts/log-issue-monitor/parsers.ts`
- Test: `scripts/log-issue-monitor/__tests__/parsers.spec.ts`

- [ ] **Step 1: Write parser tests**

Create `scripts/log-issue-monitor/__tests__/parsers.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseAppLogLine, parseJsonlRecord } from '../parsers.js';

describe('parseAppLogLine', () => {
  it('parses structured Memento log lines', () => {
    const parsed = parseAppLogLine('2026-05-02T01:02:03.000Z | ERROR | DB failed | {"component":"db","requestId":"req_123"}');

    expect(parsed).toEqual({
      timestamp: '2026-05-02T01:02:03.000Z',
      level: 'error',
      message: 'DB failed',
      metadata: { component: 'db', requestId: 'req_123' },
      raw: expect.any(String),
    });
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
      expect(parsed.error).toContain('Unexpected');
      expect(parsed.raw).toBe('{bad');
    }
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/parsers.spec.ts
```

Expected: FAIL because `parsers.ts` does not exist.

- [ ] **Step 3: Implement parsers**

Create `scripts/log-issue-monitor/parsers.ts`:

```typescript
export interface ParsedAppLogLine {
  timestamp?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, unknown>;
  raw: string;
}

export type JsonlParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; raw: string; error: string };

const STRUCTURED_LOG_PATTERN = /^([^|]+)\s+\|\s+(DEBUG|INFO|WARN|ERROR)\s+\|\s+([^|]*?)(?:\s+\|\s+(.*))?$/i;

function inferLevel(raw: string): ParsedAppLogLine['level'] {
  const lower = raw.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('exception') ||
    lower.includes('unhandledrejection') ||
    lower.includes('uncaught')
  ) {
    return 'error';
  }
  if (lower.includes('warn')) return 'warn';
  return 'info';
}

export function parseAppLogLine(raw: string): ParsedAppLogLine {
  const match = raw.match(STRUCTURED_LOG_PATTERN);
  if (!match) {
    return {
      level: inferLevel(raw),
      message: raw,
      metadata: {},
      raw,
    };
  }

  const [, timestamp, level, message, metadataRaw] = match;
  let metadata: Record<string, unknown> = {};
  if (metadataRaw?.trim()) {
    try {
      const parsed = JSON.parse(metadataRaw);
      metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      metadata = { metadataParseError: metadataRaw };
    }
  }

  return {
    timestamp: timestamp.trim(),
    level: level.toLowerCase() as ParsedAppLogLine['level'],
    message: message.trim(),
    metadata,
    raw,
  };
}

export function parseJsonlRecord(raw: string): JsonlParseResult {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, raw, error: 'JSONL record must be an object' };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      raw,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/parsers.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/parsers.ts scripts/log-issue-monitor/__tests__/parsers.spec.ts
git commit -m "feat(ops): parse monitor log sources"
```

## Task 3: Detectors

**Files:**
- Create: `scripts/log-issue-monitor/detectors.ts`
- Test: `scripts/log-issue-monitor/__tests__/detectors.spec.ts`

- [ ] **Step 1: Write detector tests**

Create `scripts/log-issue-monitor/__tests__/detectors.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/detectors.spec.ts
```

Expected: FAIL because `detectors.ts` does not exist.

- [ ] **Step 3: Implement detectors**

Create `scripts/log-issue-monitor/detectors.ts`:

```typescript
import type { LogIssueOccurrence } from './types.js';
import type { ParsedAppLogLine } from './parsers.js';

export type DetectedEvent = Omit<LogIssueOccurrence, 'fingerprint'>;

function nowIso(): string {
  return new Date().toISOString();
}

function truncateTitle(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

export function detectAppLogEvent(line: ParsedAppLogLine): DetectedEvent | undefined {
  const lower = `${line.level} ${line.message}`.toLowerCase();
  const critical =
    lower.includes('uncaughtexception') ||
    lower.includes('uncaught exception') ||
    lower.includes('unhandledrejection') ||
    lower.includes('unhandled rejection');

  if (critical) {
    return {
      source: 'app-log',
      severity: 'critical',
      title: truncateTitle(`App critical: ${line.message}`),
      normalizedMessage: line.message,
      excerpt: line.raw,
      observedAt: line.timestamp ?? nowIso(),
      context: line.metadata,
    };
  }

  if (line.level === 'error') {
    return {
      source: 'app-log',
      severity: 'error',
      title: truncateTitle(`App error: ${line.message}`),
      normalizedMessage: line.message,
      excerpt: line.raw,
      observedAt: line.timestamp ?? nowIso(),
      context: line.metadata,
    };
  }

  if (line.level === 'warn') {
    return {
      source: 'app-log',
      severity: 'warn',
      title: truncateTitle(`App warning: ${line.message}`),
      normalizedMessage: line.message,
      excerpt: line.raw,
      observedAt: line.timestamp ?? nowIso(),
      context: line.metadata,
    };
  }

  return undefined;
}

export function detectRuntimeAnomaly(record: Record<string, unknown>): DetectedEvent | undefined {
  const batchScheduler = record.batchScheduler;
  if (batchScheduler && typeof batchScheduler === 'object' && !Array.isArray(batchScheduler)) {
    const errorCount = (batchScheduler as { errorCount?: unknown }).errorCount;
    if (errorCount && typeof errorCount === 'object' && !Array.isArray(errorCount)) {
      for (const [jobName, count] of Object.entries(errorCount)) {
        if (typeof count === 'number' && count > 0) {
          return {
            source: 'app-diagnostics',
            severity: 'anomaly',
            title: `Runtime anomaly: scheduler errors for ${jobName}`,
            normalizedMessage: `scheduler error count increased for ${jobName}`,
            excerpt: JSON.stringify(record),
            observedAt: typeof record.timestamp === 'string' ? record.timestamp : nowIso(),
            context: { jobName, count },
          };
        }
      }
    }
  }
  return undefined;
}

export function detectDockerAnomaly(record: Record<string, unknown>): DetectedEvent | undefined {
  const state = record.State;
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const typedState = state as { OOMKilled?: unknown; Health?: { Status?: unknown }; Status?: unknown };
    if (typedState.OOMKilled === true) {
      return {
        source: 'docker-diagnostics',
        severity: 'critical',
        title: 'Docker critical: container OOMKilled',
        normalizedMessage: 'container OOMKilled',
        excerpt: JSON.stringify(record),
        observedAt: nowIso(),
        context: { status: typedState.Status },
      };
    }
    if (typedState.Health?.Status === 'unhealthy') {
      return {
        source: 'docker-diagnostics',
        severity: 'error',
        title: 'Docker error: container unhealthy',
        normalizedMessage: 'container unhealthy',
        excerpt: JSON.stringify(record),
        observedAt: nowIso(),
        context: { status: typedState.Status, health: typedState.Health.Status },
      };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/detectors.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/detectors.ts scripts/log-issue-monitor/__tests__/detectors.spec.ts
git commit -m "feat(ops): detect log issue events"
```

## Task 4: Fingerprint, Sanitizer, and Promotion

**Files:**
- Create: `scripts/log-issue-monitor/fingerprint.ts`
- Create: `scripts/log-issue-monitor/sanitizer.ts`
- Create: `scripts/log-issue-monitor/promotion.ts`
- Test: `scripts/log-issue-monitor/__tests__/fingerprint.spec.ts`
- Test: `scripts/log-issue-monitor/__tests__/sanitizer.spec.ts`
- Test: `scripts/log-issue-monitor/__tests__/promotion.spec.ts`

- [ ] **Step 1: Write tests**

Create `scripts/log-issue-monitor/__tests__/fingerprint.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createFingerprint, normalizeMessage } from '../fingerprint.js';

describe('normalizeMessage', () => {
  it('removes unstable IDs, timestamps, durations, and byte counts', () => {
    const normalized = normalizeMessage('request req_123 failed at 2026-05-02T00:00:00.000Z after 345ms using 12345 bytes');

    expect(normalized).toBe('request <request-id> failed at <timestamp> after <duration> using <bytes>');
  });
});

describe('createFingerprint', () => {
  it('returns the same fingerprint for equivalent unstable messages', () => {
    const first = createFingerprint({
      source: 'app-log',
      severity: 'error',
      normalizedMessage: 'request req_123 failed after 10ms',
      context: { component: 'db' },
    });
    const second = createFingerprint({
      source: 'app-log',
      severity: 'error',
      normalizedMessage: 'request req_999 failed after 20ms',
      context: { component: 'db' },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });
});
```

Create `scripts/log-issue-monitor/__tests__/sanitizer.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sanitizeExcerpt } from '../sanitizer.js';

describe('sanitizeExcerpt', () => {
  it('masks credentials and limits byte length', () => {
    const excerpt = sanitizeExcerpt('token=abcdefghijklmnopqrstuvwxyz123456 user@example.com trailing text', 40);

    expect(excerpt).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(excerpt).not.toContain('user@example.com');
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(40);
  });
});
```

Create `scripts/log-issue-monitor/__tests__/promotion.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { shouldSyncToGitHub } from '../promotion.js';
import type { LogIssueFingerprintState } from '../types.js';

const baseState: LogIssueFingerprintState = {
  fingerprint: 'abc',
  source: 'app-log',
  severity: 'warn',
  normalizedTitle: 'warning',
  firstSeenAt: '2026-05-02T00:00:00.000Z',
  lastSeenAt: '2026-05-02T00:05:00.000Z',
  occurrenceCount: 3,
  recentOccurrences: [
    { observedAt: '2026-05-02T00:00:00.000Z', excerpt: 'a', context: {} },
    { observedAt: '2026-05-02T00:03:00.000Z', excerpt: 'b', context: {} },
    { observedAt: '2026-05-02T00:05:00.000Z', excerpt: 'c', context: {} },
  ],
  status: 'local_only',
};

describe('shouldSyncToGitHub', () => {
  it('syncs errors immediately', () => {
    expect(shouldSyncToGitHub({ ...baseState, severity: 'error', occurrenceCount: 1, recentOccurrences: [] }, 3, 600)).toBe(true);
  });

  it('syncs warnings only after threshold within window', () => {
    expect(shouldSyncToGitHub(baseState, 3, 600)).toBe(true);
    expect(shouldSyncToGitHub({ ...baseState, occurrenceCount: 2, recentOccurrences: baseState.recentOccurrences.slice(0, 2) }, 3, 600)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/fingerprint.spec.ts scripts/log-issue-monitor/__tests__/sanitizer.spec.ts scripts/log-issue-monitor/__tests__/promotion.spec.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement modules**

Create `scripts/log-issue-monitor/fingerprint.ts`:

```typescript
import { createHash } from 'node:crypto';
import type { LogIssueSeverity, LogIssueSource } from './types.js';

export function normalizeMessage(message: string): string {
  return message
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g, '<timestamp>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\breq[_-]?[a-z0-9]+\b/gi, '<request-id>')
    .replace(/\bmem[_-]?[a-z0-9]+\b/gi, '<memory-id>')
    .replace(/\b\d+(?:\.\d+)?ms\b/g, '<duration>')
    .replace(/\b\d+\s*(?:bytes|byte|b)\b/gi, '<bytes>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createFingerprint(input: {
  source: LogIssueSource;
  severity: LogIssueSeverity;
  normalizedMessage: string;
  context: Record<string, unknown>;
}): string {
  const stableContext = {
    component: typeof input.context.component === 'string' ? input.context.component : undefined,
    tool: typeof input.context.tool === 'string' ? input.context.tool : undefined,
    jobName: typeof input.context.jobName === 'string' ? input.context.jobName : undefined,
  };
  const key = JSON.stringify({
    source: input.source,
    severity: input.severity,
    message: normalizeMessage(input.normalizedMessage),
    context: stableContext,
  });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
```

Create `scripts/log-issue-monitor/sanitizer.ts`:

```typescript
import { PIIMasker } from '../../packages/memento-core/src/shared/utils/pii-masker.js';

export function limitUtf8Bytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  return `${buffer.subarray(0, Math.max(0, maxBytes - 12)).toString('utf8')}...[truncated]`;
}

export function sanitizeExcerpt(excerpt: string, maxBytes: number): string {
  const masked = PIIMasker.mask(excerpt).masked;
  return limitUtf8Bytes(masked, maxBytes);
}
```

Create `scripts/log-issue-monitor/promotion.ts`:

```typescript
import type { LogIssueFingerprintState } from './types.js';

const IMMEDIATE_SEVERITIES = new Set(['critical', 'error']);

export function shouldSyncToGitHub(
  state: LogIssueFingerprintState,
  threshold: number,
  windowSeconds: number
): boolean {
  if (state.status === 'suppressed' || state.status === 'closed_remote') {
    return false;
  }
  if (IMMEDIATE_SEVERITIES.has(state.severity)) {
    return true;
  }
  const lastSeen = Date.parse(state.lastSeenAt);
  const windowStart = lastSeen - windowSeconds * 1000;
  const occurrencesInWindow = state.recentOccurrences.filter(item => Date.parse(item.observedAt) >= windowStart);
  return occurrencesInWindow.length >= threshold;
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/fingerprint.spec.ts scripts/log-issue-monitor/__tests__/sanitizer.spec.ts scripts/log-issue-monitor/__tests__/promotion.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/fingerprint.ts scripts/log-issue-monitor/sanitizer.ts scripts/log-issue-monitor/promotion.ts scripts/log-issue-monitor/__tests__/fingerprint.spec.ts scripts/log-issue-monitor/__tests__/sanitizer.spec.ts scripts/log-issue-monitor/__tests__/promotion.spec.ts
git commit -m "feat(ops): fingerprint and sanitize log issues"
```

## Task 5: State Store

**Files:**
- Create: `scripts/log-issue-monitor/state-store.ts`
- Test: `scripts/log-issue-monitor/__tests__/state-store.spec.ts`

- [ ] **Step 1: Write state store tests**

Create `scripts/log-issue-monitor/__tests__/state-store.spec.ts`:

```typescript
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendOccurrence, loadState, saveState, upsertOccurrence } from '../state-store.js';
import type { LogIssueOccurrence } from '../types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-log-monitor-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const occurrence: LogIssueOccurrence = {
  fingerprint: 'abc123',
  source: 'app-log',
  severity: 'error',
  title: 'App error: DB failed',
  normalizedMessage: 'DB failed',
  excerpt: 'DB failed',
  observedAt: '2026-05-02T00:00:00.000Z',
  context: { component: 'db' },
};

describe('state-store', () => {
  it('creates an empty state when no file exists', async () => {
    await expect(loadState(dir)).resolves.toEqual({ version: 1, cursors: {}, fingerprints: {} });
  });

  it('upserts occurrence count and caps recent occurrences', async () => {
    let state = await loadState(dir);
    for (let i = 0; i < 12; i += 1) {
      state = upsertOccurrence(state, { ...occurrence, observedAt: `2026-05-02T00:${String(i).padStart(2, '0')}:00.000Z` });
    }

    expect(state.fingerprints.abc123.occurrenceCount).toBe(12);
    expect(state.fingerprints.abc123.recentOccurrences).toHaveLength(10);
    expect(state.fingerprints.abc123.firstSeenAt).toBe('2026-05-02T00:00:00.000Z');
    expect(state.fingerprints.abc123.lastSeenAt).toBe('2026-05-02T00:11:00.000Z');
  });

  it('saves state atomically and appends occurrence JSONL', async () => {
    const state = upsertOccurrence(await loadState(dir), occurrence);
    await saveState(dir, state);
    await appendOccurrence(dir, occurrence);

    const saved = await loadState(dir);
    const jsonl = await readFile(join(dir, 'occurrences.jsonl'), 'utf8');

    expect(saved.fingerprints.abc123.occurrenceCount).toBe(1);
    expect(jsonl).toContain('"fingerprint":"abc123"');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/state-store.spec.ts
```

Expected: FAIL because `state-store.ts` does not exist.

- [ ] **Step 3: Implement state store**

Create `scripts/log-issue-monitor/state-store.ts`:

```typescript
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogIssueOccurrence, LogIssueState } from './types.js';

export function emptyState(): LogIssueState {
  return { version: 1, cursors: {}, fingerprints: {} };
}

export async function loadState(stateDir: string): Promise<LogIssueState> {
  try {
    const raw = await readFile(join(stateDir, 'state.json'), 'utf8');
    const parsed = JSON.parse(raw) as LogIssueState;
    return parsed.version === 1 && parsed.fingerprints ? parsed : emptyState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

export async function saveState(stateDir: string, state: LogIssueState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const tmpPath = join(stateDir, 'state.json.tmp');
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tmpPath, join(stateDir, 'state.json'));
}

export function upsertOccurrence(state: LogIssueState, occurrence: LogIssueOccurrence): LogIssueState {
  const existing = state.fingerprints[occurrence.fingerprint];
  const recent = [
    ...(existing?.recentOccurrences ?? []),
    { observedAt: occurrence.observedAt, excerpt: occurrence.excerpt, context: occurrence.context },
  ].slice(-10);

  return {
    ...state,
    fingerprints: {
      ...state.fingerprints,
      [occurrence.fingerprint]: {
        fingerprint: occurrence.fingerprint,
        source: occurrence.source,
        severity: occurrence.severity,
        normalizedTitle: occurrence.title,
        firstSeenAt: existing?.firstSeenAt ?? occurrence.observedAt,
        lastSeenAt: occurrence.observedAt,
        occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
        recentOccurrences: recent,
        githubIssueNumber: existing?.githubIssueNumber,
        status: existing?.status ?? 'local_only',
        lastSyncError: existing?.lastSyncError,
      },
    },
  };
}

export async function appendOccurrence(stateDir: string, occurrence: LogIssueOccurrence): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(join(stateDir, 'occurrences.jsonl'), `${JSON.stringify(occurrence)}\n`, 'utf8');
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/state-store.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/state-store.ts scripts/log-issue-monitor/__tests__/state-store.spec.ts
git commit -m "feat(ops): persist log issue monitor state"
```

## Task 6: GitHub Issue Body and Client

**Files:**
- Create: `scripts/log-issue-monitor/issue-body.ts`
- Create: `scripts/log-issue-monitor/github-client.ts`
- Test: `scripts/log-issue-monitor/__tests__/issue-body.spec.ts`
- Test: `scripts/log-issue-monitor/__tests__/github-client.spec.ts`

- [ ] **Step 1: Write issue body tests**

Create `scripts/log-issue-monitor/__tests__/issue-body.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { renderManagedIssueBody, upsertManagedIssueBody } from '../issue-body.js';
import type { LogIssueFingerprintState } from '../types.js';

const state: LogIssueFingerprintState = {
  fingerprint: 'abc123',
  source: 'app-log',
  severity: 'error',
  normalizedTitle: 'App error: DB failed',
  firstSeenAt: '2026-05-02T00:00:00.000Z',
  lastSeenAt: '2026-05-02T00:01:00.000Z',
  occurrenceCount: 2,
  recentOccurrences: [{ observedAt: '2026-05-02T00:01:00.000Z', excerpt: 'DB failed', context: { component: 'db' } }],
  status: 'local_only',
};

describe('issue body', () => {
  it('renders a managed fingerprint marker and counts', () => {
    const body = renderManagedIssueBody(state);

    expect(body).toContain('<!-- memento-log-monitor:fingerprint=abc123 -->');
    expect(body).toContain('- Occurrences: 2');
    expect(body).toContain('DB failed');
  });

  it('replaces only the managed block and preserves human text', () => {
    const original = 'Human note\n\n<!-- memento-log-monitor:fingerprint=abc123 -->\nold\n<!-- /memento-log-monitor -->\n\nMore text';
    const updated = upsertManagedIssueBody(original, state);

    expect(updated).toContain('Human note');
    expect(updated).toContain('More text');
    expect(updated).toContain('- Occurrences: 2');
    expect(updated).not.toContain('\nold\n');
  });
});
```

- [ ] **Step 2: Write GitHub client tests**

Create `scripts/log-issue-monitor/__tests__/github-client.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { GitHubIssueClient } from '../github-client.js';

describe('GitHubIssueClient', () => {
  it('searches open issues by fingerprint marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ number: 7, state: 'open', body: '<!-- memento-log-monitor:fingerprint=abc123 -->' }] }),
    });
    const client = new GitHubIssueClient({ token: 'ghp_token', repository: 'owner/repo', fetchFn: fetchMock });

    await expect(client.findOpenIssueByFingerprint('abc123', ['memento-log-monitor'])).resolves.toEqual({
      number: 7,
      state: 'open',
      body: '<!-- memento-log-monitor:fingerprint=abc123 -->',
    });
  });

  it('throws a readable error for non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    const client = new GitHubIssueClient({ token: 'bad', repository: 'owner/repo', fetchFn: fetchMock });

    await expect(client.getIssue(1)).rejects.toThrow('GitHub API failed: 403 forbidden');
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/issue-body.spec.ts scripts/log-issue-monitor/__tests__/github-client.spec.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement issue body and client**

Create `scripts/log-issue-monitor/issue-body.ts`:

```typescript
import type { LogIssueFingerprintState } from './types.js';

const START = (fingerprint: string): string => `<!-- memento-log-monitor:fingerprint=${fingerprint} -->`;
const END = '<!-- /memento-log-monitor -->';

export function renderManagedIssueBody(state: LogIssueFingerprintState): string {
  const recent = state.recentOccurrences
    .map(item => `### ${item.observedAt}\n\n\`\`\`text\n${item.excerpt}\n\`\`\``)
    .join('\n\n');

  return `${START(state.fingerprint)}
## 운영 감지 요약

- Occurrences: ${state.occurrenceCount}
- First seen: ${state.firstSeenAt}
- Last seen: ${state.lastSeenAt}
- Severity: ${state.severity}
- Source: ${state.source}
- Fingerprint: ${state.fingerprint}

## 최근 로그

${recent || '_No recent excerpt available._'}

원본 전체 로그는 로컬 \`log-issue-monitor\` 상태 디렉터리에만 보존됩니다.
${END}`;
}

export function upsertManagedIssueBody(existingBody: string | undefined, state: LogIssueFingerprintState): string {
  const managed = renderManagedIssueBody(state);
  const body = existingBody ?? '';
  const startIndex = body.indexOf(START(state.fingerprint));
  const endIndex = body.indexOf(END, startIndex);
  if (startIndex >= 0 && endIndex >= 0) {
    return `${body.slice(0, startIndex)}${managed}${body.slice(endIndex + END.length)}`;
  }
  return body.trim() ? `${body.trim()}\n\n${managed}` : managed;
}
```

Create `scripts/log-issue-monitor/github-client.ts`:

```typescript
export interface GitHubIssue {
  number: number;
  state: 'open' | 'closed';
  body?: string;
}

export interface GitHubIssueClientOptions {
  token: string;
  repository: string;
  fetchFn?: typeof fetch;
}

export class GitHubIssueClient {
  private readonly fetchFn: typeof fetch;
  private readonly apiBase = 'https://api.github.com';

  constructor(private readonly options: GitHubIssueClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async findOpenIssueByFingerprint(fingerprint: string, labels: string[]): Promise<GitHubIssue | undefined> {
    const labelQuery = labels.map(label => `label:${label}`).join(' ');
    const q = encodeURIComponent(`repo:${this.options.repository} is:issue is:open ${labelQuery} ${fingerprint}`);
    const result = await this.request<{ items: GitHubIssue[] }>(`/search/issues?q=${q}`, { method: 'GET' });
    return result.items.find(issue => issue.body?.includes(`memento-log-monitor:fingerprint=${fingerprint}`));
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues/${issueNumber}`, { method: 'GET' });
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateIssue(issueNumber: number, input: { body: string }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchFn(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.options.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/issue-body.spec.ts scripts/log-issue-monitor/__tests__/github-client.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/issue-body.ts scripts/log-issue-monitor/github-client.ts scripts/log-issue-monitor/__tests__/issue-body.spec.ts scripts/log-issue-monitor/__tests__/github-client.spec.ts
git commit -m "feat(ops): sync log issues with GitHub"
```

## Task 7: Sources and Monitor Cycle

**Files:**
- Create: `scripts/log-issue-monitor/sources.ts`
- Create: `scripts/log-issue-monitor/monitor.ts`
- Test: `scripts/log-issue-monitor/__tests__/monitor.spec.ts`

- [ ] **Step 1: Write monitor cycle test**

Create `scripts/log-issue-monitor/__tests__/monitor.spec.ts`:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMonitorCycle } from '../monitor.js';
import type { MonitorConfig } from '../types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-monitor-cycle-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(): MonitorConfig {
  return {
    containerName: 'memento-mcp-server',
    logsRoot: dir,
    stateDir: join(dir, 'state'),
    githubRepository: 'owner/repo',
    intervalSeconds: 30,
    warnThreshold: 3,
    warnWindowSeconds: 600,
    dryRun: true,
    labels: ['bug', 'memento-log-monitor'],
    maxExcerptBytes: 6000,
    includeStack: true,
  };
}

describe('runMonitorCycle', () => {
  it('records detected app log errors locally in dry-run mode', async () => {
    await runMonitorCycle(config(), {
      readDockerLogs: async () => ['2026-05-02T00:00:00.000Z | ERROR | DB failed | {"component":"db"}'],
      readJsonlFiles: async () => [],
      githubClient: undefined,
      onMonitorError: vi.fn(),
    });

    const state = await import('../state-store.js').then(module => module.loadState(join(dir, 'state')));
    const fingerprints = Object.values(state.fingerprints);

    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0].occurrenceCount).toBe(1);
    expect(fingerprints[0].status).toBe('local_only');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/monitor.spec.ts
```

Expected: FAIL because `monitor.ts` does not exist.

- [ ] **Step 3: Implement source readers**

Create `scripts/log-issue-monitor/sources.ts`:

```typescript
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function readDockerLogs(containerName: string, since?: string): Promise<string[]> {
  const args = ['logs'];
  if (since) args.push('--since', since);
  args.push(containerName);
  const { stdout, stderr } = await execFileAsync('docker', args, { maxBuffer: 10 * 1024 * 1024 });
  return `${stdout}\n${stderr}`.split('\n').map(line => line.trim()).filter(Boolean);
}

export async function readJsonlFiles(logsRoot: string): Promise<string[]> {
  const directories = [join(logsRoot, 'diagnostics'), join(logsRoot, 'docker-diagnostics')];
  const records: string[] = [];
  for (const directory of directories) {
    let files: string[] = [];
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }
    for (const file of files.filter(name => name.endsWith('.jsonl'))) {
      const path = join(directory, file);
      const info = await stat(path);
      if (!info.isFile()) continue;
      records.push(...(await readFile(path, 'utf8')).split('\n').map(line => line.trim()).filter(Boolean));
    }
  }
  return records;
}
```

- [ ] **Step 4: Implement monitor cycle**

Create `scripts/log-issue-monitor/monitor.ts`:

```typescript
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createFingerprint, normalizeMessage } from './fingerprint.js';
import { detectAppLogEvent, detectDockerAnomaly, detectRuntimeAnomaly } from './detectors.js';
import { parseAppLogLine, parseJsonlRecord } from './parsers.js';
import { sanitizeExcerpt } from './sanitizer.js';
import { appendOccurrence, loadState, saveState, upsertOccurrence } from './state-store.js';
import { shouldSyncToGitHub } from './promotion.js';
import { renderManagedIssueBody, upsertManagedIssueBody } from './issue-body.js';
import type { GitHubIssueClient } from './github-client.js';
import type { LogIssueOccurrence, MonitorConfig } from './types.js';

export interface MonitorCycleDeps {
  readDockerLogs: (containerName: string, since?: string) => Promise<string[]>;
  readJsonlFiles: (logsRoot: string) => Promise<string[]>;
  githubClient?: GitHubIssueClient;
  onMonitorError: (error: Error) => void;
}

async function recordMonitorError(stateDir: string, error: Error): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(join(stateDir, 'monitor-errors.jsonl'), `${JSON.stringify({
    timestamp: new Date().toISOString(),
    error: error.message,
  })}\n`, 'utf8');
}

function withFingerprint(event: Omit<LogIssueOccurrence, 'fingerprint'>, config: MonitorConfig): LogIssueOccurrence {
  const normalizedMessage = normalizeMessage(event.normalizedMessage);
  const fingerprint = createFingerprint({
    source: event.source,
    severity: event.severity,
    normalizedMessage,
    context: event.context,
  });
  return {
    ...event,
    fingerprint,
    normalizedMessage,
    excerpt: sanitizeExcerpt(event.excerpt, config.maxExcerptBytes),
  };
}

async function syncFingerprint(config: MonitorConfig, githubClient: GitHubIssueClient | undefined, fingerprint: string): Promise<void> {
  if (config.dryRun || !config.githubToken || !githubClient) return;
  let state = await loadState(config.stateDir);
  const item = state.fingerprints[fingerprint];
  if (!item || !shouldSyncToGitHub(item, config.warnThreshold, config.warnWindowSeconds)) return;

  const existing = item.githubIssueNumber ? await githubClient.getIssue(item.githubIssueNumber) : await githubClient.findOpenIssueByFingerprint(fingerprint, config.labels);
  if (existing?.state === 'closed') {
    state.fingerprints[fingerprint] = { ...item, status: 'closed_remote' };
    await saveState(config.stateDir, state);
    return;
  }

  if (existing) {
    const body = upsertManagedIssueBody(existing.body, item);
    await githubClient.updateIssue(existing.number, { body });
    state.fingerprints[fingerprint] = { ...item, githubIssueNumber: existing.number, status: 'opened', lastSyncError: undefined };
  } else {
    const issue = await githubClient.createIssue({
      title: item.normalizedTitle,
      body: renderManagedIssueBody(item),
      labels: config.labels,
    });
    state.fingerprints[fingerprint] = { ...item, githubIssueNumber: issue.number, status: 'opened', lastSyncError: undefined };
  }
  await saveState(config.stateDir, state);
}

export async function runMonitorCycle(config: MonitorConfig, deps: MonitorCycleDeps): Promise<void> {
  try {
    let state = await loadState(config.stateDir);
    const dockerLines = await deps.readDockerLogs(config.containerName, state.cursors.dockerLogsSince as string | undefined);
    const jsonlLines = await deps.readJsonlFiles(config.logsRoot);

    const occurrences: LogIssueOccurrence[] = [];
    for (const line of dockerLines) {
      const event = detectAppLogEvent(parseAppLogLine(line));
      if (event) occurrences.push(withFingerprint(event, config));
    }
    for (const line of jsonlLines) {
      const parsed = parseJsonlRecord(line);
      if (!parsed.ok) continue;
      const event = detectRuntimeAnomaly(parsed.value) ?? detectDockerAnomaly(parsed.value);
      if (event) occurrences.push(withFingerprint(event, config));
    }

    for (const occurrence of occurrences) {
      state = upsertOccurrence(state, occurrence);
      await appendOccurrence(config.stateDir, occurrence);
    }
    state.cursors.dockerLogsSince = new Date().toISOString();
    await saveState(config.stateDir, state);

    for (const occurrence of occurrences) {
      await syncFingerprint(config, deps.githubClient, occurrence.fingerprint);
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    deps.onMonitorError(normalized);
    await recordMonitorError(config.stateDir, normalized);
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/monitor.spec.ts
```

Expected: PASS.

Commit:

```bash
git add scripts/log-issue-monitor/sources.ts scripts/log-issue-monitor/monitor.ts scripts/log-issue-monitor/__tests__/monitor.spec.ts
git commit -m "feat(ops): run log issue monitor cycle"
```

## Task 8: Entrypoint and Package Scripts

**Files:**
- Create: `scripts/log-issue-monitor/index.ts`
- Modify: `package.json`
- Test: `scripts/log-issue-monitor/__tests__/entrypoint.spec.ts`

- [ ] **Step 1: Write entrypoint smoke test**

Create `scripts/log-issue-monitor/__tests__/entrypoint.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createMonitorRuntime } from '../index.js';

describe('createMonitorRuntime', () => {
  it('creates a runtime without a GitHub client in local-only mode', () => {
    const runtime = createMonitorRuntime({
      GITHUB_TOKEN: '',
      LOG_ISSUE_MONITOR_DRY_RUN: 'true',
      LOG_ISSUE_MONITOR_LOGS_ROOT: '/tmp/logs',
    });

    expect(runtime.config.githubToken).toBeUndefined();
    expect(runtime.githubClient).toBeUndefined();
    expect(runtime.config.dryRun).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/entrypoint.spec.ts
```

Expected: FAIL because `index.ts` does not exist.

- [ ] **Step 3: Implement entrypoint**

Create `scripts/log-issue-monitor/index.ts`:

```typescript
import { loadMonitorConfig } from './config.js';
import { GitHubIssueClient } from './github-client.js';
import { runMonitorCycle } from './monitor.js';
import { readDockerLogs, readJsonlFiles } from './sources.js';
import type { MonitorConfig } from './types.js';

export function createMonitorRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: MonitorConfig;
  githubClient?: GitHubIssueClient;
} {
  const config = loadMonitorConfig(env);
  const githubClient = config.githubToken && !config.dryRun
    ? new GitHubIssueClient({ token: config.githubToken, repository: config.githubRepository })
    : undefined;
  return { config, githubClient };
}

export async function runForever(): Promise<void> {
  const { config, githubClient } = createMonitorRuntime();
  const run = async (): Promise<void> => {
    await runMonitorCycle(config, {
      readDockerLogs,
      readJsonlFiles,
      githubClient,
      onMonitorError: error => {
        process.stderr.write(`log-issue-monitor error: ${error.message}\n`);
      },
    });
  };

  process.stderr.write(`log-issue-monitor started for ${config.containerName}; interval=${config.intervalSeconds}s dryRun=${config.dryRun}\n`);
  while (true) {
    await run();
    await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runForever().catch(error => {
    process.stderr.write(`log-issue-monitor fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
{
  "ops:log-issue-monitor": "tsx scripts/log-issue-monitor/index.ts",
  "test:log-issue-monitor": "vitest run scripts/log-issue-monitor/"
}
```

Keep existing scripts unchanged and insert these near the Docker or monitoring scripts.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run scripts/log-issue-monitor/__tests__/entrypoint.spec.ts
npm run test:log-issue-monitor
```

Expected: PASS.

Commit:

```bash
git add package.json scripts/log-issue-monitor/index.ts scripts/log-issue-monitor/__tests__/entrypoint.spec.ts
git commit -m "feat(ops): add log issue monitor entrypoint"
```

## Task 9: Docker and Compose Overlay

**Files:**
- Create: `docker/log-issue-monitor/Dockerfile`
- Create: `docker-compose.issue-monitor.yml`

- [ ] **Step 1: Create Dockerfile**

Create `docker/log-issue-monitor/Dockerfile`:

```dockerfile
FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /workspace

COPY package*.json ./
COPY tsconfig*.json ./
COPY packages/memento-core/package*.json ./packages/memento-core/
COPY packages/memento-server/package*.json ./packages/memento-server/
COPY packages/memento-client/package*.json ./packages/memento-client/
COPY packages/mcp-client/package*.json ./packages/mcp-client/
COPY apps/experimental-example/package*.json ./apps/experimental-example/
COPY scripts ./scripts
COPY packages/memento-core/src/shared ./packages/memento-core/src/shared

RUN npm ci --ignore-scripts

CMD ["npx", "tsx", "scripts/log-issue-monitor/index.ts"]
```

- [ ] **Step 2: Create compose overlay**

Create `docker-compose.issue-monitor.yml`:

```yaml
version: '3.8'

services:
  log-issue-monitor:
    build:
      context: .
      dockerfile: docker/log-issue-monitor/Dockerfile
    depends_on:
      - memento-mcp-server
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      GITHUB_REPOSITORY: ${GITHUB_REPOSITORY:-jee1lee/memento}
      LOG_ISSUE_MONITOR_CONTAINER_NAME: ${LOG_ISSUE_MONITOR_CONTAINER_NAME:-memento-mcp-server}
      LOG_ISSUE_MONITOR_INTERVAL_SECONDS: ${LOG_ISSUE_MONITOR_INTERVAL_SECONDS:-30}
      LOG_ISSUE_MONITOR_WARN_THRESHOLD: ${LOG_ISSUE_MONITOR_WARN_THRESHOLD:-3}
      LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS: ${LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS:-600}
      LOG_ISSUE_MONITOR_DRY_RUN: ${LOG_ISSUE_MONITOR_DRY_RUN:-false}
      LOG_ISSUE_MONITOR_LABELS: ${LOG_ISSUE_MONITOR_LABELS:-bug,needs-triage,memento-log-monitor}
      LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES: ${LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES:-6000}
      LOG_ISSUE_MONITOR_INCLUDE_STACK: ${LOG_ISSUE_MONITOR_INCLUDE_STACK:-true}
      LOG_ISSUE_MONITOR_LOGS_ROOT: /logs
      LOG_ISSUE_MONITOR_STATE_DIR: /logs/log-issue-monitor
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOME}/.memento/logs:/logs
    restart: unless-stopped
```

- [ ] **Step 3: Validate compose config**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.issue-monitor.yml config
```

Expected: PASS and rendered output includes `log-issue-monitor`.

If Docker is unavailable locally, run:

```bash
docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.issue-monitor.yml config --quiet
```

Expected: PASS. If this still fails because Docker Compose is unavailable, record the failure in the final handoff and do not fake success.

- [ ] **Step 4: Commit**

Commit:

```bash
git add docker/log-issue-monitor/Dockerfile docker-compose.issue-monitor.yml
git commit -m "feat(ops): add log issue monitor compose overlay"
```

## Task 10: Documentation and Verification

**Files:**
- Create: `docs/operations/ko/log-issue-monitor.md`
- Create: `docs/operations/en/log-issue-monitor.md`
- Modify: `README.md`

- [ ] **Step 1: Write Korean operations guide**

Create `docs/operations/ko/log-issue-monitor.md`:

```markdown
# Log Issue Monitor 운영 가이드

Log Issue Monitor는 Memento 운영 로그와 Docker diagnostics 파일을 주기적으로 검사해 오류 또는 이상 증상을 로컬에 기록하고, 심각하거나 반복되는 fingerprint를 GitHub Issue로 등록하거나 갱신하는 opt-in 프로세스입니다.

## 실행

\`\`\`bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
\`\`\`

## Local-only 모드

\`GITHUB_TOKEN\`을 설정하지 않으면 monitor는 GitHub에 쓰지 않고 \`${HOME}/.memento/logs/log-issue-monitor\` 아래에만 기록합니다. 이 모드는 정상 운영 모드입니다.

## GitHub 동기화

GitHub Issue 생성을 켜려면 Issues write 권한이 있는 token을 \`GITHUB_TOKEN\`으로 주입합니다.

\`\`\`bash
GITHUB_TOKEN=... docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
\`\`\`

## 출력 파일

- \`state.json\`: fingerprint별 count, last seen, GitHub issue number
- \`occurrences.jsonl\`: append-only 발생 이력
- \`monitor-errors.jsonl\`: monitor 자체 오류

## 보안

이 오버레이는 Docker socket을 마운트하므로 신뢰할 수 있는 운영/진단 환경에서만 사용합니다. GitHub로 전송되는 로그 excerpt는 민감정보 마스킹과 길이 제한을 거칩니다.
```

- [ ] **Step 2: Write English operations guide**

Create `docs/operations/en/log-issue-monitor.md`:

```markdown
# Log Issue Monitor Operations Guide

Log Issue Monitor is an opt-in process that periodically scans Memento runtime logs and Docker diagnostics files. It records every detected occurrence locally and creates or updates GitHub Issues for severe or recurring fingerprints.

## Run

\`\`\`bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
\`\`\`

## Local-Only Mode

When \`GITHUB_TOKEN\` is unset, the monitor does not write to GitHub. It only records state under \`${HOME}/.memento/logs/log-issue-monitor\`. This is a normal operating mode.

## GitHub Sync

To enable GitHub Issue creation, provide a token with Issues write permission through \`GITHUB_TOKEN\`.

\`\`\`bash
GITHUB_TOKEN=... docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
\`\`\`

## Output Files

- \`state.json\`: fingerprint counts, last seen timestamps, and GitHub issue numbers
- \`occurrences.jsonl\`: append-only occurrence history
- \`monitor-errors.jsonl\`: monitor self-errors

## Security

This overlay mounts the Docker socket, so use it only in trusted operations or diagnostics environments. Excerpts sent to GitHub are masked and length-limited.
```

- [ ] **Step 3: Update README**

Add this short paragraph near Docker or diagnostics documentation in `README.md`:

```markdown
### Log Issue Monitor

운영 로그와 Docker diagnostics를 주기적으로 검사해 반복 오류를 GitHub Issue로 묶어 관리하려면 opt-in `docker-compose.issue-monitor.yml` 오버레이를 사용할 수 있습니다. 자세한 절차는 [Log Issue Monitor 운영 가이드](../../operations/ko/log-issue-monitor.md)를 참고하세요.
```

- [ ] **Step 4: Run full monitor verification**

Run:

```bash
npm run test:log-issue-monitor
git diff --check
docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.issue-monitor.yml config --quiet
```

Expected: all PASS. If Docker Compose is unavailable, document the exact error and complete the other two checks.

- [ ] **Step 5: Commit**

Commit:

```bash
git add docs/operations/ko/log-issue-monitor.md docs/operations/en/log-issue-monitor.md README.md
git commit -m "docs(ops): document log issue monitor"
```

## Final Verification

- [ ] Run focused tests:

```bash
npm run test:log-issue-monitor
```

Expected: PASS.

- [ ] Run type check:

```bash
npm run type-check
```

Expected: PASS. If unrelated existing failures appear, capture them exactly.

- [ ] Run lint:

```bash
npm run lint
```

Expected: PASS. If unrelated existing failures appear, capture them exactly.

- [ ] Validate compose:

```bash
docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.issue-monitor.yml config --quiet
```

Expected: PASS.

- [ ] Confirm git status:

```bash
git status --short
```

Expected: no uncommitted files.

## Spec Coverage Check

This plan covers:

- Separate Docker process: Tasks 9 and 10.
- Periodic app and diagnostics inspection: Tasks 7 and 8.
- Fingerprint normalization: Task 4.
- Local durable recording: Task 5.
- GitHub create/update/dedupe: Task 6 and Task 7.
- Severity and recurrence rules: Task 4.
- Sensitive data masking: Task 4 and Task 6.
- Opt-in Docker socket boundary: Task 9 and Task 10.
