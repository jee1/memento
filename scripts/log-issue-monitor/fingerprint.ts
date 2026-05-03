import { createHash } from 'node:crypto';
import type { LogIssueSeverity, LogIssueSource } from './types.js';

export function normalizeMessage(message: string): string {
  return message
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g, '<timestamp>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\breq[_-][a-z0-9]+\b/gi, '<request-id>')
    .replace(/\bmem[_-][a-z0-9]+\b/gi, '<memory-id>')
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
