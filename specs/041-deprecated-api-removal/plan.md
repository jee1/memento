# Plan: core-deprecated-inventory API 제거

## Architecture

| Module | Change |
|--------|--------|
| `environment.ts` | `MEMENTO_TYPE_PARAM_MODE` default `warn` → `error` |
| `type-param-validator.ts` | `parseTypeParamMode` default `error`; remove `[LEGACY TYPE]` from deprecate message |
| `check-debt-markers.ts` | Remove `[LEGACY TYPE]` ignore pattern (no longer needed) |
| `core-deprecated-inventory.md` | Move last row to Removed in #636 |
| `type-param-rollout.md` | Document new default |
| `CHANGELOG.md` | Breaking change entry |
| Tests | Update default expectations; keep explicit warn/deprecate mode tests |

## Test Strategy

- Unit: `type-param-validator.spec.ts` (both paths)
- Integration: `remember-tool.spec.ts` error default describe block
- Gate: `check-debt-markers --production-only`, full CI suite

## Breaking Change

Clients omitting `type` on `remember`/`recall` will receive errors unless `MEMENTO_TYPE_PARAM_MODE=warn|deprecate` is set.
