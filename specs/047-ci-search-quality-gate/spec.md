# Feature Specification: CI Search Quality Gate

**Feature Branch**: `issue-665-ci-search-quality`  
**Created**: 2026-07-05  
**Issue**: [#665](https://github.com/jee1/memento/issues/665) — chore(ci): 중요 테스트 스킵 해소 및 search-quality CI 게이트  
**Parent epic**: [#661](https://github.com/jee1/memento/issues/661)

## Problem

PR CI는 `SKIP_DB_TESTS`, `SKIP_INTEGRATION_TESTS`, `vitest.config.ts` CI exclude(db/integration/performance/quality-assurance)로 무거운 테스트를 생략한다.  
그러나 `npm run test:vector-search-quality:ci`(벡터·하이브리드 랭킹 benchmark)는 workflow에 포함되지 않아, 랭킹 가중치 변경 PR에서 검색 품질 회귀를 자동으로 잡지 못한다.

## Goals

1. PR gate: `test-search-quality` job에서 `test:vector-search-quality:ci` 실행
2. Weekly workflow: `SKIP_*=false` 환경에서 search-quality + integration subset 복원
3. exclude inventory를 `docs/reference/ko/ci-test-timeout-guide.md`에 명시하고 만료 정책(2026-09-01) 부여

## User Scenarios

### User Story 1 — 랭킹 가중치 PR 회귀 차단 (P1)

개발자가 hybrid search 랭킹 가중치를 변경하면 CI benchmark가 실패하고 PR merge가 차단된다.

**Acceptance**: `test-search-quality` job 실패 시 PR gate red.

### User Story 2 — 스킵 테스트 가시성 (P2)

운영·리뷰어가 CI에서 제외된 Vitest 패턴과 대체 실행 경로(nightly/로컬)를 문서에서 확인한다.

**Acceptance**: ci-test-timeout-guide.md에 패턴·사유·대체 job·만료일 표.

### User Story 3 — Weekly integration 복원 (P3)

매주 integration subset이 `SKIP_*=false`로 실행되어 PR에서 스킵된 핵심 DB·migration 테스트가 회귀를 잡는다.

**Acceptance**: `nightly-tests.yml` schedule + workflow_dispatch.

## Requirements

- **FR-001**: `.github/workflows/ci.yml` — `test-search-quality` job (`needs: lint-typecheck`, timeout 45m, sqlite deps, artifact upload).
- **FR-002**: `.github/workflows/nightly-tests.yml` — weekly cron, `SKIP_DB_TESTS=false`, `SKIP_INTEGRATION_TESTS=false`.
- **FR-003**: `docs/reference/ko/ci-test-timeout-guide.md` — Vitest CI exclude inventory + `test-search-quality` job 설명.
- **FR-004**: `CHANGELOG.md` Unreleased 항목.

## Out of Scope

- vitest CI exclude 전면 제거 (wall-clock)
- benchmark fixture v3 corpus 확장 (별도 이슈)
- relation-engine 품질 리포트 CI 복원

## Success Criteria (Issue #665 Acceptance)

- [x] `.github/workflows/ci.yml`에 search-quality job
- [x] 스킵 테스트 inventory 표 (파일·대체 job)
- [x] 랭킹 가중치 변경 PR에서 benchmark 회귀 감지 (`test-search-quality`)
