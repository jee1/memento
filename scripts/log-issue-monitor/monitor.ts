import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { detectAppLogEvent, detectDockerAnomaly, detectRuntimeAnomaly } from './detectors.js';
import { createFingerprint, normalizeMessage } from './fingerprint.js';
import type { GitHubIssueClient } from './github-client.js';
import { renderManagedIssueBody, upsertManagedIssueBody } from './issue-body.js';
import { parseAppLogLine, parseJsonlRecord } from './parsers.js';
import { shouldSyncToGitHub } from './promotion.js';
import { sanitizeExcerpt } from './sanitizer.js';
import { appendOccurrence, loadState, saveState, upsertOccurrence } from './state-store.js';
import type { JsonlFileCursors, LogIssueOccurrence, MonitorConfig } from './types.js';
import type { ReadJsonlFilesResult } from './sources.js';

export interface MonitorCycleDeps {
  readDockerLogs: (containerName: string, since?: string) => Promise<string[]>;
  readJsonlFiles: (logsRoot: string, cursors?: JsonlFileCursors) => Promise<ReadJsonlFilesResult>;
  githubClient?: GitHubIssueClient;
  onMonitorError: (error: Error) => void;
}

async function recordMonitorError(stateDir: string, error: Error): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await appendFile(
    join(stateDir, 'monitor-errors.jsonl'),
    `${JSON.stringify({ timestamp: new Date().toISOString(), error: error.message })}\n`,
    'utf8',
  );
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

async function syncFingerprint(
  config: MonitorConfig,
  githubClient: GitHubIssueClient | undefined,
  fingerprint: string,
): Promise<void> {
  if (config.dryRun || !config.githubToken || !githubClient) return;

  const state = await loadState(config.stateDir);
  const item = state.fingerprints[fingerprint];
  if (!item || !shouldSyncToGitHub(item, config.warnThreshold, config.warnWindowSeconds)) return;

  try {
    const existing = item.githubIssueNumber
      ? await githubClient.getIssue(item.githubIssueNumber)
      : await githubClient.findOpenIssueByFingerprint(fingerprint, config.labels);

    if (existing?.state === 'closed') {
      state.fingerprints[fingerprint] = { ...item, status: 'closed_remote' };
      await saveState(config.stateDir, state);
      return;
    }

    if (existing) {
      const body = upsertManagedIssueBody(existing.body, item);
      await githubClient.updateIssue(existing.number, { body });
      state.fingerprints[fingerprint] = {
        ...item,
        githubIssueNumber: existing.number,
        status: 'opened',
        lastSyncError: undefined,
      };
    } else {
      const issue = await githubClient.createIssue({
        title: item.normalizedTitle,
        body: renderManagedIssueBody(item),
        labels: config.labels,
      });
      state.fingerprints[fingerprint] = {
        ...item,
        githubIssueNumber: issue.number,
        status: 'opened',
        lastSyncError: undefined,
      };
    }

    await saveState(config.stateDir, state);
  } catch (error) {
    state.fingerprints[fingerprint] = {
      ...item,
      status: 'sync_failed',
      lastSyncError: error instanceof Error ? error.message : String(error),
    };
    await saveState(config.stateDir, state);
    throw error;
  }
}

export async function runMonitorCycle(config: MonitorConfig, deps: MonitorCycleDeps): Promise<void> {
  try {
    let state = await loadState(config.stateDir);
    const dockerLines = await deps.readDockerLogs(config.containerName, state.cursors.dockerLogsSince);
    const jsonlResult = await deps.readJsonlFiles(config.logsRoot, state.cursors.jsonlFiles);
    const jsonlLines = jsonlResult.lines;

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
    state.cursors.jsonlFiles = jsonlResult.cursors;
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

