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
    lower.includes('unhandledpromiserejection') ||
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
