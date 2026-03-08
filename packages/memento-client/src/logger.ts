/**
 * Minimal logger for @memento/client (no dependency on repo shared).
 * Uses console; level can be set via LOG_LEVEL (debug | info | warn | error).
 */

const levelOrder = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof levelOrder)[number];

const currentLevel: Level = (() => {
  const env = typeof process !== 'undefined' && process.env?.LOG_LEVEL?.toLowerCase();
  if (env && levelOrder.includes(env as Level)) return env as Level;
  return 'info';
})();

function shouldLog(level: Level): boolean {
  return levelOrder.indexOf(level) >= levelOrder.indexOf(currentLevel);
}

function log(level: Level, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[MementoClient][${level}]`, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
