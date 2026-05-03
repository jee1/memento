import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MonitorConfig } from './types.js';

const defaultLogsRoot = (): string => join(homedir(), '.memento', 'logs');

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function labelsFromEnv(value: string | undefined): string[] {
  const labels = value?.split(',').map(label => label.trim()).filter(Boolean);
  return labels && labels.length > 0 ? labels : ['bug', 'needs-triage', 'memento-log-monitor'];
}

export function loadMonitorConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const logsRoot = optionalString(env.LOG_ISSUE_MONITOR_LOGS_ROOT) ?? defaultLogsRoot();
  return {
    containerName: optionalString(env.LOG_ISSUE_MONITOR_CONTAINER_NAME) ?? 'memento-mcp-server',
    logsRoot,
    stateDir: optionalString(env.LOG_ISSUE_MONITOR_STATE_DIR) ?? `${logsRoot}/log-issue-monitor`,
    githubToken: optionalString(env.GITHUB_TOKEN),
    githubRepository: optionalString(env.GITHUB_REPOSITORY) ?? 'jee1/memento',
    intervalSeconds: numberFromEnv(env.LOG_ISSUE_MONITOR_INTERVAL_SECONDS, 30),
    warnThreshold: numberFromEnv(env.LOG_ISSUE_MONITOR_WARN_THRESHOLD, 3),
    warnWindowSeconds: numberFromEnv(env.LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS, 600),
    dryRun: booleanFromEnv(env.LOG_ISSUE_MONITOR_DRY_RUN, false),
    labels: labelsFromEnv(env.LOG_ISSUE_MONITOR_LABELS),
    maxExcerptBytes: numberFromEnv(env.LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES, 6000),
    includeStack: booleanFromEnv(env.LOG_ISSUE_MONITOR_INCLUDE_STACK, true),
  };
}
