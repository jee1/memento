import type { ParsedAppLogLine } from './parsers.js';
import type { LogIssueOccurrence } from './types.js';

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
    lower.includes('unhandledpromiserejection') ||
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
