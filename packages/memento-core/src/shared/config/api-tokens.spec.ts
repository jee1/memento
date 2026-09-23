import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetLegacyApiTokenDeprecationLogForTests, resolveApiTokens } from './api-tokens.js';

describe('resolveApiTokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetLegacyApiTokenDeprecationLogForTests();
  });

  it('parses MEMENTO_API_TOKENS JSON array', () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'tools-1', secret: 'tools-secret', scopes: ['tools:invoke'] },
        { id: 'admin-1', secret: 'admin-secret', scopes: ['admin:destructive'] },
      ]),
    );

    const tokens = resolveApiTokens(undefined);
    expect(tokens).toEqual([
      { id: 'tools-1', secret: 'tools-secret', scopes: ['tools:invoke'] },
      { id: 'admin-1', secret: 'admin-secret', scopes: ['admin:destructive'] },
    ]);
  });

  it('synthesizes legacy-admin token when only ADMIN_API_KEY is set', () => {
    const tokens = resolveApiTokens('legacy-key');
    expect(tokens).toEqual([
      {
        id: 'legacy-admin',
        secret: 'legacy-key',
        scopes: ['tools:invoke', 'admin:destructive'],
      },
    ]);
  });

  it('returns empty array when no env tokens and no admin key', () => {
    expect(resolveApiTokens(undefined)).toEqual([]);
    expect(resolveApiTokens('   ')).toEqual([]);
  });

  it('logs an error when a configured MEMENTO_API_TOKENS falls back to the legacy key', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_API_TOKENS', 'not-json');

    const tokens = resolveApiTokens('legacy-key');

    expect(tokens).toEqual([
      { id: 'legacy-admin', secret: 'legacy-key', scopes: ['tools:invoke', 'admin:destructive'] },
    ]);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('Scoped-token migration has NOT taken effect'),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
  });

  it('does not log the migration error when MEMENTO_API_TOKENS is unset', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    resolveApiTokens('legacy-key');

    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('Scoped-token migration has NOT taken effect'),
      ),
    ).toBe(false);

    errorSpy.mockRestore();
  });
});

describe('#1126: 환경변수 이름이 값 자리에 들어간 자격증명은 폐기한다', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetLegacyApiTokenDeprecationLogForTests();
  });

  it('ADMIN_API_KEY 가 실제로 설정된 다른 환경변수의 이름이면 토큰을 만들지 않는다', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');

    expect(resolveApiTokens('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN')).toEqual([]);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).startsWith('ADMIN_API_KEY discarded:'),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
  });

  it('폐기 로그에 값 자체를 남기지 않는다', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');

    resolveApiTokens('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN');

    // 판정이 틀렸다면 그 값은 진짜 비밀이다. 키 이름만 남기고 값은 절대 남기지 않는다.
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN'),
      ),
    ).toBe(false);

    errorSpy.mockRestore();
  });

  it('MEMENTO_API_TOKENS 가 환경변수 이름이면 "설정되지 않은 것"으로 다룬다', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');
    vi.stubEnv('MEMENTO_API_TOKENS', 'MEMENTO_ALLOW_INSECURE_HTTP_ADMIN');

    expect(resolveApiTokens('real-legacy-secret')).toEqual([
      { id: 'legacy-admin', secret: 'real-legacy-secret', scopes: ['tools:invoke', 'admin:destructive'] },
    ]);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).startsWith('MEMENTO_API_TOKENS discarded:'),
      ),
    ).toBe(true);
    // 마이그레이션 실패가 아니라 애초에 설정되지 않은 것으로 다뤄야 한다 (#1115 에러는 뜨면 안 됨).
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('Scoped-token migration has NOT taken effect'),
      ),
    ).toBe(false);

    errorSpy.mockRestore();
  });

  it('2026-09-23 운영 사고 재현: 두 키가 모두 오염되면 programmatic 접근이 fail-closed 된다', () => {
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');
    vi.stubEnv('MEMENTO_API_TOKENS', 'MEMENTO_ALLOW_INSECURE_HTTP_ADMIN');

    expect(resolveApiTokens('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN')).toEqual([]);
  });

  it('SCREAMING_SNAKE 이라도 설정된 환경변수가 아니면 비밀로 그대로 쓴다', () => {
    expect(resolveApiTokens('MY_SECRET_PASSPHRASE_2026')).toEqual([
      { id: 'legacy-admin', secret: 'MY_SECRET_PASSPHRASE_2026', scopes: ['tools:invoke', 'admin:destructive'] },
    ]);
  });

  it('밑줄 없는 대문자 16진수 비밀은 걸리지 않는다', () => {
    vi.stubEnv('DEADBEEF', 'set-but-irrelevant');

    expect(resolveApiTokens('DEADBEEF')).toEqual([
      { id: 'legacy-admin', secret: 'DEADBEEF', scopes: ['tools:invoke', 'admin:destructive'] },
    ]);
  });
});
