import { describe, expect, it } from 'vitest';

import { createApiTokenRegistry, hasScope } from './api-token-registry.js';

describe('api-token-registry', () => {
  it('resolves configured secrets and checks scopes', () => {
    const registry = createApiTokenRegistry([
      { id: 'tools-1', secret: 'tools-secret', scopes: ['tools:invoke'] },
      { id: 'admin-1', secret: 'admin-secret', scopes: ['admin:destructive', 'tools:invoke'] },
    ]);

    expect(registry.hasConfiguredTokens()).toBe(true);

    const tools = registry.resolveToken('tools-secret');
    expect(tools).toEqual({ id: 'tools-1', scopes: ['tools:invoke'] });
    expect(hasScope(tools!.scopes, 'tools:invoke')).toBe(true);
    expect(hasScope(tools!.scopes, 'admin:destructive')).toBe(false);

    const admin = registry.resolveToken('admin-secret');
    expect(hasScope(admin!.scopes, ['tools:invoke', 'admin:destructive'])).toBe(true);
    expect(registry.resolveToken('missing')).toBeNull();
  });
});
