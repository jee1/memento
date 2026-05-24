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
  jsonlMaxReadBytes: number;
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

/** Byte offsets keyed by path relative to logs root (e.g. `diagnostics/app-runtime.jsonl`). */
export type JsonlFileCursors = Record<string, number>;

export interface JsonlReadSkip {
  path: string;
  unreadBytes: number;
  maxReadBytes: number;
}

export interface LogIssueState {
  version: 1;
  cursors: {
    dockerLogsSince?: string;
    jsonlFiles?: JsonlFileCursors;
    [key: string]: unknown;
  };
  fingerprints: Record<string, LogIssueFingerprintState>;
}
