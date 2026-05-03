import type { LogIssueFingerprintState } from './types.js';

const END_MARKER = '<!-- /memento-log-monitor -->';

function startMarker(fingerprint: string): string {
  return `<!-- memento-log-monitor:fingerprint=${fingerprint} -->`;
}

export function renderManagedIssueBody(state: LogIssueFingerprintState): string {
  const recentOccurrences = state.recentOccurrences
    .map(
      occurrence => `### ${occurrence.observedAt}

\`\`\`text
${occurrence.excerpt}
\`\`\``,
    )
    .join('\n\n');

  return `${startMarker(state.fingerprint)}
## 운영 감지 요약

- Occurrences: ${state.occurrenceCount}
- First seen: ${state.firstSeenAt}
- Last seen: ${state.lastSeenAt}
- Severity: ${state.severity}
- Source: ${state.source}
- Fingerprint: ${state.fingerprint}

## 최근 로그

${recentOccurrences || '_No recent excerpt available._'}

원본 전체 로그는 로컬 \`log-issue-monitor\` 상태 디렉터리에만 보존됩니다.
${END_MARKER}`;
}

export function upsertManagedIssueBody(existingBody: string | undefined, state: LogIssueFingerprintState): string {
  const managedBody = renderManagedIssueBody(state);
  const body = existingBody ?? '';
  const marker = startMarker(state.fingerprint);
  const startIndex = body.indexOf(marker);
  const endIndex = startIndex >= 0 ? body.indexOf(END_MARKER, startIndex) : -1;

  if (startIndex >= 0 && endIndex >= 0) {
    return `${body.slice(0, startIndex)}${managedBody}${body.slice(endIndex + END_MARKER.length)}`;
  }

  return body.trim() ? `${body.trim()}\n\n${managedBody}` : managedBody;
}

