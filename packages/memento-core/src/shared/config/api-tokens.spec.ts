import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveApiTokens } from './api-tokens.js';

describe('resolveApiTokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('does not synthesize a token from ADMIN_API_KEY (#1241)', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const tokens = resolveApiTokens('legacy-key');

    expect(tokens).toEqual([]);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('#1241');

    errorSpy.mockRestore();
  });

  it('returns empty array when no env tokens and no admin key', () => {
    expect(resolveApiTokens(undefined)).toEqual([]);
    expect(resolveApiTokens('   ')).toEqual([]);
  });

  it('returns [] for an unusable MEMENTO_API_TOKENS even with ADMIN_API_KEY set (#1241)', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_API_TOKENS', 'not-json');

    const tokens = resolveApiTokens('legacy-key');

    expect(tokens).toEqual([]);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('MEMENTO_API_TOKENS is not valid JSON'),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
  });

  it('parses agent_id and trims whitespace', () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'bound', secret: 'bound-secret', scopes: ['tools:invoke'], agent_id: '  codex-agent  ' },
      ]),
    );

    const tokens = resolveApiTokens(undefined);
    expect(tokens).toEqual([
      { id: 'bound', secret: 'bound-secret', scopes: ['tools:invoke'], agentId: 'codex-agent' },
    ]);
  });

  it('omits agentId when agent_id is absent', () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'unbound', secret: 'unbound-secret', scopes: ['tools:invoke'] },
      ]),
    );

    const tokens = resolveApiTokens(undefined);
    expect(tokens).toEqual([
      { id: 'unbound', secret: 'unbound-secret', scopes: ['tools:invoke'] },
    ]);
    expect(tokens[0]).not.toHaveProperty('agentId');
  });

  it('ignores entries with invalid agent_id while parsing valid siblings', async () => {
    const { logger } = await import('../utils/logger.js');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'bad-empty', secret: 's1', scopes: ['tools:invoke'], agent_id: '' },
        { id: 'bad-space', secret: 's2', scopes: ['tools:invoke'], agent_id: '  ' },
        { id: 'bad-number', secret: 's3', scopes: ['tools:invoke'], agent_id: 42 },
        { id: 'bad-null', secret: 's4', scopes: ['tools:invoke'], agent_id: null },
        { id: 'good', secret: 'good-secret', scopes: ['tools:invoke'], agent_id: 'agent-a' },
      ]),
    );

    const tokens = resolveApiTokens(undefined);
    expect(tokens).toEqual([
      { id: 'good', secret: 'good-secret', scopes: ['tools:invoke'], agentId: 'agent-a' },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(
      warnSpy.mock.calls.every(([message]) =>
        String(message).includes('agent_id must be a non-empty string'),
      ),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('does not log the migration error when MEMENTO_API_TOKENS is unset', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    expect(resolveApiTokens(undefined)).toEqual([]);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('#1241'),
      ),
    ).toBe(false);

    errorSpy.mockRestore();
  });
});

describe('#1126: 환경변수 이름이 값 자리에 들어간 자격증명은 폐기한다', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ADMIN_API_KEY 가 실제로 설정된 다른 환경변수의 이름이면 토큰을 만들지 않는다', () => {
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');

    expect(resolveApiTokens('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN')).toEqual([]);
  });

  it('폐기 로그에 값 자체를 남기지 않는다', async () => {
    const { logger } = await import('../utils/logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.stubEnv('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', 'true');

    expect(resolveApiTokens('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN')).toEqual([]);

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

    expect(resolveApiTokens('real-legacy-secret')).toEqual([]);
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
    expect(resolveApiTokens('MY_SECRET_PASSPHRASE_2026')).toEqual([]);
  });

  it('밑줄 없는 대문자 16진수 비밀은 걸리지 않는다', () => {
    vi.stubEnv('DEADBEEF', 'set-but-irrelevant');

    expect(resolveApiTokens('DEADBEEF')).toEqual([]);
  });
});
