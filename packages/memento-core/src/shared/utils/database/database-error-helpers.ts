import { logger } from '../logger.js';

export const log = (message: string, meta?: Record<string, unknown>): void => {
  if (process.env.MEMENTO_DB_DEBUG === '1') {
    logger.debug(message, meta);
  }
};

export function getSqliteErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

export function getErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = (error as { message?: unknown }).message;
  return typeof candidate === 'string' ? candidate : undefined;
}

export function getErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = (error as { name?: unknown }).name;
  return typeof candidate === 'string' ? candidate : undefined;
}
