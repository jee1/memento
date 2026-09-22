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
