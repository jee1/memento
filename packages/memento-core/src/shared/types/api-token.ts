/**
 * HTTP programmatic API token scopes (Issue #662).
 */
export type ApiScope = 'tools:invoke' | 'admin:destructive';

export const API_SCOPES: readonly ApiScope[] = ['tools:invoke', 'admin:destructive'] as const;

export type ApiTokenEntry = {
  id: string;
  secret: string;
  scopes: ApiScope[];
};
