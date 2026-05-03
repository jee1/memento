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
