# Quickstart: 임베딩 JSON → Float32 BLOB (#809)

**Date**: 2026-09-01 | **Plan**: [plan.md](./plan.md) | **Branch**: `feature/perf-embedding-json-float32-233mb-45mb`

## 1. 현재 상태 확인

```bash
cd /home/jee1lee/orca/workspaces/memento/perf-embedding-json-float32-233mb-45mb
npm ci && npm run build -w packages/memento-core
```

JSON 저장·json_extract 의존 지점:

```bash
grep -n "json_extract(NEW.embedding" packages/memento-core/src/infrastructure/database/sqlite/vec-schema.ts
grep -n "JSON.stringify(storedVector)" packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
grep -rn "JSON.parse.*embedding" packages/memento-core/src packages/memento-server/src --include='*.ts' | grep -v spec | grep -v __tests__
```

#755 atomic rebuild 참고:

```bash
sed -n '92,182p' packages/memento-core/src/infrastructure/database/sqlite/migrate.ts
```

041 post-txn vec repopulate 선례:

```bash
sed -n '58,110p' packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/041-vec-cosine-metric.ts
```

## 2. 구현 순서 (tasks.md와 동일)

1. `shared/utils/embedding-serialization.ts` + spec (TDD)
2. `vec-schema.ts` + schema.sql + vec-schema.spec
3. `043-embedding-float32-blob.ts` + failure injection spec
4. Write path: `memory-embedding-service.ts`
5. Read paths (5 files) + admin map
6. Fixture grep `JSON.stringify` in embedding INSERT tests → BLOB helper
7. `npm run lint && npm run type-check && npm test`

## 3. 로컬 migration smoke (합성 DB)

```bash
npm test -w packages/memento-core -- \
  src/infrastructure/database/sqlite/migration/migrations/043-embedding-float32-blob.spec.ts
```

## 4. 배포 전 운영 체크 (FR-004, FR-022)

```bash
npm run db:pre-docker-deploy
# 통과 후 마이그레이션 게이트용 환경 변수 설정 (043 validateBefore)
export MEMENTO_DB_PRECHECK_OK=1
# MCP/HTTP 프로세스 중지 후 단독 기동으로 migrate 실행 (FR-022: 동시 쓰기 잠금 없음 — ops-only)
```

테스트·로컬 smoke에서 precheck를 건너뛰려면:

```bash
export MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK=1
# 또는 NODE_ENV=test (vitest 기본)
```

`MEMENTO_DB_PRECHECK_OK` / `MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK` 없이 프로덕션 경로에서 043 `validateBefore`는 FR-004로 거부합니다.

## 5. 성공 기준 스모크

| SC | Command / check |
|----|-----------------|
| SC-004 | `checkVecCardinality(db)` all matched |
| SC-003 | `npx vitest run packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/043-embedding-top10-parity.spec.ts` (합성 fixture only; no live DB paths) |
| SC-001/002 | dbstat after VACUUM (manual on copy DB) |
| SC-007 | `npm run lint && npm run type-check && npm test` |

## 6. graphify (Constitution IV)

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
# graphify-out/ 확인 — 커밋 금지
```
