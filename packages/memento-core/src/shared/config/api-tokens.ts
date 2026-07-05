import { logger } from '../utils/logger.js';
import type { ApiScope, ApiTokenEntry } from '../types/api-token.js';
import { API_SCOPES } from '../types/api-token.js';
import { getRawEnvValue } from './environment.js';

const LEGACY_ADMIN_TOKEN_ID = 'legacy-admin';
const LEGACY_DEPRECATION_MESSAGE =
  'ADMIN_API_KEY is deprecated for programmatic HTTP access. ' +
  'Migrate to MEMENTO_API_TOKENS with scoped tokens (tools:invoke, admin:destructive). ' +
  'Legacy key currently grants both scopes via synthetic token id "legacy-admin".';

let legacyDeprecationLogged = false;

function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

function parseTokenEntry(raw: unknown, index: number): ApiTokenEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    logger.warn('MEMENTO_API_TOKENS entry ignored: expected object', { index });
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const secret = typeof record.secret === 'string' ? record.secret.trim() : '';
  const scopesRaw = record.scopes;

  if (!id || !secret) {
    logger.warn('MEMENTO_API_TOKENS entry ignored: id and secret are required', { index, id: id || undefined });
    return null;
  }

  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0) {
    logger.warn('MEMENTO_API_TOKENS entry ignored: scopes must be a non-empty array', { index, id });
    return null;
  }

  const scopes: ApiScope[] = [];
  for (const scope of scopesRaw) {
    if (isApiScope(scope)) {
      scopes.push(scope);
    } else {
      logger.warn('MEMENTO_API_TOKENS entry ignored: unknown scope', { index, id, scope });
      return null;
    }
  }

  return { id, secret, scopes };
}

function parseEnvTokens(raw: string): ApiTokenEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error('MEMENTO_API_TOKENS is not valid JSON; ignoring configured tokens', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.error('MEMENTO_API_TOKENS must be a JSON array');
    return [];
  }

  const tokens: ApiTokenEntry[] = [];
  parsed.forEach((entry, index) => {
    const token = parseTokenEntry(entry, index);
    if (token) {
      tokens.push(token);
    }
  });
  return tokens;
}

function synthesizeLegacyAdminToken(adminApiKey: string): ApiTokenEntry {
  if (!legacyDeprecationLogged) {
    logger.warn(LEGACY_DEPRECATION_MESSAGE);
    legacyDeprecationLogged = true;
  }
  return {
    id: LEGACY_ADMIN_TOKEN_ID,
    secret: adminApiKey.trim(),
    scopes: ['tools:invoke', 'admin:destructive'],
  };
}

/**
 * Resolve programmatic API tokens from env.
 * - MEMENTO_API_TOKENS JSON array when set and non-empty
 * - else ADMIN_API_KEY synthesized as legacy-admin with both scopes (deprecation warn once)
 */
export function resolveApiTokens(adminApiKey: string | undefined): ApiTokenEntry[] {
  const rawTokensEnv = getRawEnvValue('MEMENTO_API_TOKENS');
  if (rawTokensEnv !== undefined && rawTokensEnv.trim() !== '') {
    const envTokens = parseEnvTokens(rawTokensEnv.trim());
    if (envTokens.length > 0) {
      return envTokens;
    }
  }

  if (adminApiKey && adminApiKey.trim() !== '') {
    return [synthesizeLegacyAdminToken(adminApiKey)];
  }

  return [];
}

/** Test-only reset for deprecation log guard. */
export function resetLegacyApiTokenDeprecationLogForTests(): void {
  legacyDeprecationLogged = false;
}
