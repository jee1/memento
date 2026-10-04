import { logger } from '../utils/logger.js';
import type { ApiScope, ApiTokenEntry } from '../types/api-token.js';
import { API_SCOPES } from '../types/api-token.js';
import { getRawEnvValue } from './environment.js';

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

/**
 * SCREAMING_SNAKE_CASE (밑줄 1개 이상). 환경변수 이름의 관용 표기다.
 * 대문자 16진수 비밀(밑줄 없음)은 걸리지 않는다.
 */
const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * #1126: 자격증명 값이 "이 프로세스에 실제로 존재하는 다른 환경변수의 이름"이면 비밀이 아니다.
 *
 * 2026-09-23 운영에서 MEMENTO_API_TOKENS 와 ADMIN_API_KEY 가 둘 다 문자열
 * "MEMENTO_ALLOW_INSECURE_HTTP_ADMIN" 이었다. .env 를 편집하다 값 자리에 키 이름이
 * 들어간 사고인데, 그 문자열이 그대로 인증을 통과해 LAN 에 열린 포트에서 admin:destructive
 * 까지 열려 있었다. 두 키가 동시에 같은 사고를 당해 사람 눈으로는 대조가 안 됐다.
 *
 * 경고만으로는 부족하다 — 당시에도 "MEMENTO_API_TOKENS is not valid JSON" 에러가 로그에
 * 남아 있었지만 아무도 보지 않았다. 값을 폐기해 fail-closed 로 만든다. 자격증명이 사라지면
 * programmatic 경로는 401 이 되고, 루프백이 아닌 바인딩이면 기동 자체가 막힌다
 * (getMementoHttpSecurityStartupViolationMessage). 둘 다 무증상보다 낫다.
 *
 * 값은 로그에 남기지 않는다. 판정이 틀렸다면 그 값은 진짜 비밀이기 때문이다.
 */
function discardEnvVarNameValue(key: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !ENV_VAR_NAME_PATTERN.test(trimmed)) {
    return value;
  }
  if (getRawEnvValue(trimmed) === undefined) {
    return value;
  }
  logger.error(
    `${key} discarded: its value is the name of another environment variable that is set in this ` +
      'process, not a credential. A variable name was pasted into the value in .env. ' +
      'Programmatic API access fails closed until a real secret is configured.',
  );
  return undefined;
}

/**
 * Resolve programmatic API tokens from MEMENTO_API_TOKENS only (#1241: no ADMIN_API_KEY fallback).
 * ADMIN_API_KEY is accepted only to log that it no longer grants programmatic access.
 */
export function resolveApiTokens(adminApiKey: string | undefined): ApiTokenEntry[] {
  const rawTokensEnv = discardEnvVarNameValue('MEMENTO_API_TOKENS', getRawEnvValue('MEMENTO_API_TOKENS'));
  const tokensEnvConfigured = rawTokensEnv !== undefined && rawTokensEnv.trim() !== '';
  const envTokens = tokensEnvConfigured ? parseEnvTokens(rawTokensEnv.trim()) : [];

  if (envTokens.length === 0 && adminApiKey && adminApiKey.trim() !== '') {
    // #1241: ADMIN_API_KEY no longer grants programmatic access; it only unlocks the dashboard login.
    logger.error(
      'ADMIN_API_KEY no longer grants programmatic HTTP access (#1241). ' +
        'Configure MEMENTO_API_TOKENS with scoped tokens (tools:invoke, admin:destructive); ' +
        'programmatic API requests are rejected until then.',
    );
  }
  return envTokens;
}
