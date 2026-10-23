import type { ApiScope, ApiTokenEntry } from '@memento/core';

export type ResolvedApiToken = {
  id: string;
  scopes: ApiScope[];
  agentId?: string;
  projectId?: string;
};

export type ApiTokenRegistry = {
  hasConfiguredTokens: () => boolean;
  resolveToken: (secret: string | null | undefined) => ResolvedApiToken | null;
};

export function createApiTokenRegistry(tokens: readonly ApiTokenEntry[]): ApiTokenRegistry {
  const bySecret = new Map<string, ResolvedApiToken>();

  for (const token of tokens) {
    const secret = token.secret.trim();
    if (!secret) {
      continue;
    }
    bySecret.set(secret, {
      id: token.id,
      scopes: [...token.scopes],
      ...(token.agentId ? { agentId: token.agentId } : {}),
      ...(token.projectId ? { projectId: token.projectId } : {}),
    });
  }

  return {
    hasConfiguredTokens(): boolean {
      return bySecret.size > 0;
    },
    resolveToken(secret: string | null | undefined): ResolvedApiToken | null {
      if (!secret) {
        return null;
      }
      const trimmed = secret.trim();
      return trimmed === '' ? null : (bySecret.get(trimmed) ?? null);
    },
  };
}

export function hasScope(
  scopes: readonly ApiScope[],
  required: ApiScope | ApiScope[],
): boolean {
  const requiredScopes = Array.isArray(required) ? required : [required];
  return requiredScopes.every((scope) => scopes.includes(scope));
}

export function hasAnyScope(
  scopes: readonly ApiScope[],
  candidates: readonly ApiScope[],
): boolean {
  return candidates.some((scope) => scopes.includes(scope));
}
