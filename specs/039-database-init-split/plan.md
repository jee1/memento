# Implementation Plan: 039-database-init-split

## Architecture

`init.ts` god node(713줄)를 **composition**으로 분해한다. Public import 경로(`init.js`)와 `initializeDatabase`·`closeDatabase` export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
init.ts                      # 오케스트레이션, public API
init-legacy-schema.ts        # 레거시 컬럼·VEC 테이블 정합·populateVecTables
init-sqlite-session.ts       # pragma·확장·UDF
init-migration-baseline.ts   # schema.sql baseline 버전 기록
init-migrate-existing.ts     # 기존 DB 마이그레이션
init-bootstrap-new-db.ts     # 신규 DB 초기화 전략
```

## Changes

| 파일 | 변경 |
|------|------|
| `init-legacy-schema.ts` | 신규 — 레거시 스키마·VEC |
| `init-sqlite-session.ts` | 신규 — SQLite 세션 설정 |
| `init-migration-baseline.ts` | 신규 — baseline 기록 |
| `init-migrate-existing.ts` | 신규 — 기존 DB 마이그레이션 |
| `init-bootstrap-new-db.ts` | 신규 — 신규 DB bootstrap |
| `init.ts` | 축소 — orchestrate only |

## Test Strategy

- 선행: `init.spec.ts` + `migrate.spec.ts` green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run build && npm test && npm run lint && npm run type-check`
- 배포: `npm run db:pre-docker-deploy`

## Constitution Alignment

- Structural refactoring exception (Constitution I): CI green = regression signal
- Backward compatibility (Constitution II): import path·public API 유지
- Schema/migration boundary (Constitution III): migration/ 모듈 미변경
- Quality gates (Constitution IV) 필수
