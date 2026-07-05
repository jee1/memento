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
});
