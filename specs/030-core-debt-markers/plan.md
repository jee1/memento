# Implementation Plan: 030-core-debt-markers

## Architecture

tech-debt-analyzer(2026-06-27)는 대소문자 무시 **부분 문자열** 매칭으로 `debug`→BUG, `xxx.yyy`→XXX 등 false positive가 발생한다. 본 작업은 (1) 수정 가능한 문구 정리 (2) canonical 스캐너 `check-debt-markers.ts`로 actionable 기준 고정 (3) DEPRECATED inventory 문서화.

## Changes

| 파일 | 변경 |
|------|------|
| `scripts/check-debt-markers.ts` | 신규 — 프로덕션 actionable 마커 검사 |
| `docs/architecture/core-deprecated-inventory.md` | 신규 — @deprecated·레거시 경고 inventory |
| `package.json` | `check-debt-markers` 스크립트 |
| `batch-scheduler.ts`, `init.ts`, `search-engine.ts` | 주석에서 debug/BUG 유발 문구 제거 |
| `012-fix-tfidf-dimension-trigger.ts` | `buggy` → `incorrect legacy` |
| `pii-masker.ts`, `logger.spec.ts` | JWT 주석 xxx 제거 |
| `failure-detector.ts`, `config/index.ts` | `bug`/`bug-fix` → `defect`/`defect-fix` |
| `type-param-validator.ts` | `[DEPRECATED]` → `[LEGACY TYPE]` (의미 유지) |
| `remember-tool.ts` | deprecated private shim 삭제 |
| `remember-tool-relation-load.spec.ts` | db-helpers 직접 테스트 |
| `vector-search-engine-migration.ts` | 삭제 (미참조) |

## Test Strategy

- `npm run check-debt-markers -- --production-only`
- `npm run build && npm test && npm run lint && npm run type-check`

## Constitution Alignment

- Structural/chore cleanup: CI green baseline이 회귀 신호 (Constitution I exception)
- Quality gates (Constitution IV) 필수
