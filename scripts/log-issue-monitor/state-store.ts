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
