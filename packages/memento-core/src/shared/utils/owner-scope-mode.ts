/**
 * HTTP owner scope enforcement mode (Issue #664)
 */

export type OwnerScopeMode = 'strict' | 'warn' | 'off';

/**
 * @param envValue - MEMENTO_OWNER_SCOPE_MODE
 * @returns valid mode or default `strict`
 */
export function parseOwnerScopeMode(envValue: string | undefined): OwnerScopeMode {
  if (!envValue) {
    return 'strict';
  }

  const normalized = envValue.toLowerCase().trim();
  if (normalized === 'strict' || normalized === 'warn' || normalized === 'off') {
    return normalized;
  }

  console.warn(`⚠️  Invalid MEMENTO_OWNER_SCOPE_MODE value: ${envValue}. Using default 'strict'.`);
  return 'strict';
}
