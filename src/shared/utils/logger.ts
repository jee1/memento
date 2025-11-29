export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    return `[unserializable: ${(error as Error).message}]`;
  }
}

function formatTime(date: Date = new Date()): string {
  return date.toISOString();
}

function buildLogMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const parts = [formatTime(), level.toUpperCase(), message];
  if (meta && Object.keys(meta).length > 0) {
    parts.push(safeStringify(meta));
  }
  return parts.join(' | ');
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(buildLogMessage('debug', message, meta));
  },
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(buildLogMessage('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(buildLogMessage('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(buildLogMessage('error', message, meta));
  }
};
