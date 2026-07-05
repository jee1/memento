# Implementation Plan: Issue #665

**Branch**: `issue-665-ci-search-quality`

## Changes

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | `test-search-quality` job 추가 (lint-typecheck needs, sqlite, `test:vector-search-quality:ci`, artifact) |
| `.github/workflows/nightly-tests.yml` | 신규 — weekly cron `0 2 * * 0`, SKIP_*=false, search-quality + integration subset |
| `docs/reference/ko/ci-test-timeout-guide.md` | exclude inventory 표, job 타임아웃, nightly 대체 경로 |
| `CHANGELOG.md` | Unreleased Added (#665) |
| `specs/047-ci-search-quality-gate/` | spec·plan·tasks |

## ci.yml — test-search-quality

- `needs: [ lint-typecheck ]` — 다른 test-* job과 병렬
- `timeout-minutes: 45`
- SQLite apt install (test-core와 동일)
- `npm run test:vector-search-quality:ci` — JUnit/JSON → `test-results/`
- failure artifact: `test-results-search-quality`

## nightly-tests.yml

- **schedule**: 일요일 02:00 UTC
- **workflow_dispatch**: 수동 실행
- **env**: `SKIP_DB_TESTS=false`, `SKIP_INTEGRATION_TESTS=false`
- **Job 1** `test-search-quality`: PR gate와 동일 benchmark, skip flags off
- **Job 2** `test-integration-subset`: vitest CI exclude 대상 중 3건 직접 실행
  - `migration-runner.integration.spec.ts`
  - `database-lock-scenarios.integration.spec.ts`
  - `memory-embedding-service.integration.spec.ts`

## Documentation

- Vitest exclude 8행 inventory + env SKIP 표
- 만료 정책: **2026-09-01** 분기별 재검토

## Verification

- YAML syntax: `python3 -c "import yaml; ..."`
- TS 변경 없음 — lint/type-check 생략 가능
- (선택) 로컬 `npm run test:vector-search-quality:ci` — CI와 동일 스크립트
