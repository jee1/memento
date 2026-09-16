/**
 * remember write-path near-duplicate policy (Issue #730)
 */

export type RememberDedupMode = 'warn' | 'strict' | 'off';

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_LEXICAL_FLOOR = 0.3;
const DEFAULT_MERGE_LEXICAL_FLOOR = 0.7;

/**
 * @param envValue - MEMENTO_REMEMBER_DEDUP_THRESHOLD
 * @returns valid threshold in (0, 1] or default 0.85
 */
export function parseRememberDedupThreshold(envValue: string | undefined): number {
  if (!envValue) {
    return DEFAULT_THRESHOLD;
  }

  const parsed = Number(envValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    process.stderr.write(
      `[CONFIG WARN] Invalid MEMENTO_REMEMBER_DEDUP_THRESHOLD value: ${envValue}. Using default '${DEFAULT_THRESHOLD}'.\n`,
    );
    return DEFAULT_THRESHOLD;
  }

  return parsed;
}

/**
 * @param envValue - MEMENTO_REMEMBER_DEDUP_MODE
 * @returns valid mode or default `warn`
 */
export function parseRememberDedupMode(envValue: string | undefined): RememberDedupMode {
  if (!envValue) {
    return 'warn';
  }

  const normalized = envValue.toLowerCase().trim();
  if (normalized === 'warn' || normalized === 'strict' || normalized === 'off') {
    return normalized;
  }

  process.stderr.write(
    `[CONFIG WARN] Invalid MEMENTO_REMEMBER_DEDUP_MODE value: ${envValue}. Using default 'warn'.\n`,
  );
  return 'warn';
}

/**
 * @param envValue - MEMENTO_REMEMBER_DEDUP_LEXICAL_FLOOR
 * @returns valid floor in [0, 1] or default 0.3 (0 = gate disabled)
 */
export function parseRememberDedupLexicalFloor(envValue: string | undefined): number {
  if (!envValue) {
    return DEFAULT_LEXICAL_FLOOR;
  }

  const parsed = Number(envValue.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    process.stderr.write(
      `[CONFIG WARN] Invalid MEMENTO_REMEMBER_DEDUP_LEXICAL_FLOOR value: ${envValue}. Using default '${DEFAULT_LEXICAL_FLOOR}'.\n`,
    );
    return DEFAULT_LEXICAL_FLOOR;
  }

  return parsed;
}

/**
 * @param envValue - MEMENTO_REMEMBER_DEDUP_MERGE_LEXICAL_FLOOR
 * @returns valid floor in [0, 1] or default 0.7 (0 = merge gate disabled)
 */
export function parseRememberDedupMergeLexicalFloor(envValue: string | undefined): number {
  if (!envValue) {
    return DEFAULT_MERGE_LEXICAL_FLOOR;
  }

  const parsed = Number(envValue.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    process.stderr.write(
      `[CONFIG WARN] Invalid MEMENTO_REMEMBER_DEDUP_MERGE_LEXICAL_FLOOR value: ${envValue}. Using default '${DEFAULT_MERGE_LEXICAL_FLOOR}'.\n`,
    );
    return DEFAULT_MERGE_LEXICAL_FLOOR;
  }

  return parsed;
}
