# Implementation Plan: HTTP Scoped API Tokens (#662)

## Architecture

```text
MEMENTO_API_TOKENS (env JSON)
        ↓
memento-core resolveApiTokens()
        ↓
mementoConfig.apiTokens[]
        ↓
createApiTokenRegistry() → programmatic-auth / admin-auth middleware
        ↓
Route mounts in http-server.ts (scope per prefix)
```

## Files

| Layer | File | Change |
|-------|------|--------|
| core types | `shared/types/api-token.ts` | ApiScope, ApiTokenEntry |
| core config | `shared/config/api-tokens.ts` | parse + legacy synthesis |
| core config | `shared/config/index.ts` | `apiTokens` field |
| server auth | `server/auth/api-token-registry.ts` | resolveToken, hasScope |
| server | `middleware/programmatic-auth.middleware.ts` | scope-aware auth |
| server | `middleware/admin-auth.middleware.ts` | admin:destructive wrapper |
| server | `http-server.ts` | registry + route scopes |
| tests | `scoped-api-tokens.integration.spec.ts` | matrix |
| docs | `docs/reference/ko/security.md`, `docs/integrations/_shared/auth.md` | scoped tokens |

## Migration

1. 기존: `ADMIN_API_KEY` only → 동작 유지 (legacy-admin, warn once).
2. 신규: `MEMENTO_API_TOKENS` JSON — tools 전용 + admin 전용 키 분리.
3. 원격 바인드: `apiTokens.length > 0` 또는 `ADMIN_API_KEY` 필요.

## Verification

```bash
npm run build
npm run test:ci:server -- scoped-api-tokens
npm run lint && npm run type-check
```
