# Implementation Plan: Epic #748 — chore tech-debt 2026-08

**Branch**: `060-chore-tech-debt-2026-08` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/060-chore-tech-debt-2026-08/spec.md`  
**Research**: [research.md](./research.md) (Confirmed 7 · Partial 1)

---

## Summary

신규 기능·대형 재설계 없이, 데이터 손실·채널 격리 실패·배포 실패·거짓 CI green 위험이 큰 운영·보안·배포 부채를 자식 이슈(#749–#756)별 **독립 소형 PR**로 해소한다.

기술 접근: 기존 pack/prepack·vitest·better-sqlite3 transaction·architecture spec·security workflow를 **확장**만 한다. 신규 bundler·분석기·ML force-override·package 재설계·eslint/vitest major는 Non-Goals.

권장 착수 순서(P0 → P1): **#752 → #754 → #750 → #755 → #751 → #756 → #753 → #749**.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: npm workspaces (`@memento/core`, `memento-server`, `@memento/client`, `@memento/assistant`, `@memento/agent-integration`), Express 5.x, Zod, better-sqlite3, sqlite-vec  
**Storage**: SQLite (`memory_embedding` rebuild / metadata repair)  
**Testing**: Vitest 3.x (unit · integration · e2e); CI `lint` · `type-check` · targeted vitest  
**Target Platform**: Linux server / MCP stdio + HTTP admin  
**Project Type**: Monorepo MCP memory server + ops scripts + GitHub Actions  
**Performance Goals**: #753 — create/search/stats hot path에서 테이블 전역 metadata repair `UPDATE` 0회  
**Constraints**: Public MCP/API 호환 유지; wanted-only dep bumps; no ML dependency force-override; no new frameworks/abstractions/bundlers; production 변경 시 graphify 재빌드  
**Scale/Scope**: 8 child issues · 8 independent PRs · production `src` 루트 7개 유지(에픽 baseline)

---

## Constitution Check

*GATE: Must pass before implementation. Re-checked after this plan.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Delivery | **PASS** | 이슈마다 실패 재현/회귀 테스트 → 최소 수정 → 통과 |
| II. Backward Compatibility | **PASS** | #754: nested `filters` flatten + top-level MCP 필드 유지; malformed/missing 호환 |
| III. Schema and Migration Discipline | **PASS** | #755 atomic rebuild; #753 metadata repair를 bootstrap/migrate로 이동(스키마·migrate·타입 동시) |
| IV. Quality Gates | **PASS** | PR마다 `lint` · `type-check` · 대상 테스트; production 변경 시 graphify |
| V. Observability (SHOULD) | **PASS** | 범위 내 graceful 유지; 신규 관측 스택 없음 |
| Runtime / workspaces | **PASS** | Node 24+, npm workspaces 유지 |

**Complexity Tracking**: 해당 없음(게이트 위반 없음).

---

## Phases (per issue)

### Phase 1 — #752 fix(pack): 배포 tarball 런타임 closure

**Decision (locked):** root `dependencies`에 `express-rate-limit` · `helmet` · `umap-js` 정렬. `@memento/agent-integration`은 **registry publish 하지 않고** 기존 `prepack-bundle-core` / `bundledDependencies` 경로를 확장해 tarball에 **bundle**한다. 신규 bundler 금지.

**Touch:**
- `package.json` (deps · `bundledDependencies`)
- `scripts/prepack-bundle-core.js` (또는 동등 prepack 확장)
- `scripts/verify-npm-pack-bundle.js` (server closure 경로 assert)
- `packages/memento-server/package.json` (대조용)
- 회귀 테스트: pack verify / empty-temp install smoke (기존 pack 스크립트 경로 확장)

**Verify:**
```bash
npm run verify-pack-bundle
# empty temp: npm pack → install → bin smoke (workspace-less)
npm run type-check && npm run lint
```

---

### Phase 2 — #754 fix(recall): filters wire · 채널 격리

**Decision (locked):** nested `filters`를 **공유 `executeTool` / HTTP tools 진입에서 1회 flatten**. top-level MCP 필드 호환 유지. 채널 태그는 client/assistant가 보낸 filters를 core가 존중하는 방식으로 복원(per-channel fork 금지).

**Touch:**
- `packages/memento-core/src/tools/index.ts` (`executeTool` normalize)
- `packages/memento-server/src/server/routes/tools.routes.ts` (필요 시 진입 정렬; 중복 flatten 금지)
- `packages/memento-core/src/domains/memory/tools/recall-tool.ts` (검증·회귀만; 가능하면 해석은 경계층)
- `packages/memento-assistant/test/e2e/channel-isolation.e2e.spec.ts` (`it.skip` 제거)
- `packages/memento-assistant/package.json` (`test:ci`에 `test/` 포함)
- filters flatten 단위/통합 테스트

**Verify:**
```bash
npm test -- packages/memento-core # filters normalize / recall
npm run test:ci -w @memento/assistant
# channel-isolation.e2e 실행·통과
npm run type-check && npm run lint
# production 변경 시 graphify 재빌드
```

---

### Phase 3 — #750 fix(scripts): monorepo import 경로

**Decision (locked):** root에 **등록된** ops 스크립트만 `@memento/core` public/workspace export로 수정. 미사용 legacy/archive 삭제. SQL 복제 integration → 파라미터화 CLI/import smoke + CI 포함(`*.integration.spec.ts` exclude 밖).

**Touch:**
- `scripts/*` (등록 npm 스크립트 대상; `../src/` → `@memento/core/...`)
- `package.json` (ops script 엔트리 · `test:ci:scripts` smoke 포함)
- `@memento/core` public exports (필요 최소면)
- `scripts/__tests__/` CLI/import smoke (SQL 재구현 제거/대체)

**Verify:**
```bash
# 등록 스크립트에서 루트 src/ import 0건 검사
npm run migrate:embedding -- --help   # 및 동등 analyze smoke
npm run test:ci:scripts
npm run type-check && npm run lint
```

---

### Phase 4 — #755 fix(db): memory_embedding rebuild 원자성

**Decision (locked):** create/copy/drop/rename만 기존 better-sqlite3 `db.transaction(...)`로 감싼다. 신규 migration 프레임워크 없음.

**Touch:**
- `packages/memento-core/src/infrastructure/database/database/migrate.ts`
- failure-injection · 성공 · 멱등 테스트 (migrate 인접 `__tests__`)

**Verify:**
```bash
npm test -- packages/memento-core/src/infrastructure/database # rebuild atomicity
npm run type-check && npm run lint
# production 변경 시 graphify 재빌드
```

---

### Phase 5 — #751 fix(ci): nightly MigrationRunner 실실행

**Decision (locked):** **전용 exclude env/flag** 선호(예: `VITEST_INCLUDE_MIGRATION_RUNNER=1`). 가능하면 blanket `CI=` unset보다 flag 게이트. PR CI exclude 의도 유지. collected 0 tests → 스텝 실패.

**Touch:**
- `vitest.config.ts` (CI exclude ↔ include flag)
- `.github/workflows/nightly-tests.yml` (flag + zero-test fail)
- PR workflow는 migration-runner exclude 유지

**Verify:**
```bash
# nightly 상당: flag on → migration-runner.integration.spec.ts 9건 수집·실행
# flag off / PR CI → exclude 유지
# 0 tests 시 스텝 non-zero exit
```

---

### Phase 6 — #756 chore(security): fixable audit + gate

**Decision (locked):** wanted-only lockfile bump (`@hono/node-server`, `hono`, `fast-uri`, `ip-address`, `protobufjs`). `security-check.yml`에 `npm audit --omit=dev` gate. upstream-blocked(ML 등) 문서화. onnxruntime/sharp force-override · eslint/vitest major 금지.

**Touch:**
- `package-lock.json` / 해당 workspace `package.json`
- `.github/workflows/security-check.yml`
- docs (upstream-blocked 기록; 기존 ops/security 문서 경로 우선)

**Verify:**
```bash
npm audit --omit=dev   # fixable High/Moderate = 0
npm run type-check && npm run lint
# security-check workflow audit step 존재
```

---

### Phase 7 — #753 perf(embedding): metadata repair → migration

**Decision (locked):** `ensureMetadataDefaults` SQL을 bootstrap/`migrate.ts`(또는 기존 init 경로)에서 1회 실행. create/search/stats hot-path 호출 제거. query-count + legacy fixture 회귀 필수. (#755 이후 착수 권장 — 동일 `memory_embedding` 수명주기)

**Touch:**
- `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts`
- `packages/memento-core/src/infrastructure/database/database/migrate.ts` 및/또는 schema init/bootstrap
- query-count · legacy fixture 테스트

**Verify:**
```bash
npm test -- packages/memento-core/src/domains/memory # embedding metadata / query-count
npm run type-check && npm run lint
# production 변경 시 graphify 재빌드
```

---

### Phase 8 — #749 test(architecture): 의존 방향 · runtime cycle

**Status note (Partial):** implement 시 cycle 2건 재확인. 방향 문서 클레임은 `docs/agents/architecture.md` **~L21**(섹션 헤딩 ~L19; 이슈의 L19는 off-by-two).

**Decision (locked):** `dependency-boundaries.spec.ts` 확장 + allowlist(rationale). 확인된 cycle 2건 제거(`import type` / helpers 분리 / `batch-scheduler-types` 패턴). madge·dependency-cruiser 등 신규 analyzer 금지. allowlist 무분별 증가 = CI 실패 또는 명시 리뷰.

**Touch:**
- `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`
- cycle break: `shared/utils/database.ts` ↔ schema-init/fts5 경로; `batch-scheduler` ↔ `batch-scheduler-singleton`
- 필요 시 `docs/agents/architecture.md` 정합(라인·allowlist 근거)

**Verify:**
```bash
npm test -- packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts
npm run type-check && npm run lint
# production 변경 시 graphify 재빌드
```

---

## Test Strategy

공통: Constitution I — **이슈당** (1) 실패하는 재현/회귀 테스트 추가·unskip (2) 최소 수정 (3) 통과. 완료 전 `npm run lint` · `npm run type-check` · 대상 테스트. production 코드 변경 시 graphify 재빌드.

| Issue | Red (먼저) | Green (수정 후) |
|-------|------------|-----------------|
| #752 | verify가 server external 누락에 실패 / empty-temp bin smoke 실패 | deps+bundle+verify 확장 후 pack smoke 통과 |
| #754 | nested `filters` 미적용 단위 테스트; channel-isolation e2e skip→실패 | flatten + unskip + `test:ci`에 `test/` |
| #750 | 등록 스크립트 `../src/` 검출 / CLI spawn smoke 실패 | `@memento/core` 경로 + CI smoke |
| #755 | copy 후 실패 주입 → 테이블 유실 assert | `db.transaction` 후 롤백·멱등 통과 |
| #751 | nightly 상당 수집 0건 또는 exclude로 스킵 | flag include + 0-tests fail; PR exclude 유지 |
| #756 | audit High/Moderate fixable > 0 / gate 없음 | wanted bump + workflow gate + upstream-blocked doc |
| #753 | hot path query-count에 전역 UPDATE > 0 | migrate 1회 + hot path 0 |
| #749 | 신규 금지 import / 잔존 cycle로 architecture 실패 | allowlist+cycle break 후 통과 |

에픽 baseline: `npm run check-debt-markers -- --production-only` 유지.

---

## Project Structure

### Documentation (this feature)

```text
specs/060-chore-tech-debt-2026-08/
├── spec.md          # requirements
├── research.md      # Phase 0 evidence + decisions
├── plan.md          # this file
└── tasks.md         # NOT in this step (/speckit.tasks)
```

*(verify 명령은 위 Phases에 포함; 별도 `quickstart.md` 없음)*

### Source paths touched (by phase)

```text
package.json
package-lock.json
vitest.config.ts
.github/workflows/nightly-tests.yml
.github/workflows/security-check.yml
scripts/prepack-bundle-core.js
scripts/verify-npm-pack-bundle.js
scripts/*                          # #750 registered ops only
scripts/__tests__/
packages/memento-core/src/tools/index.ts
packages/memento-core/src/domains/memory/tools/recall-tool.ts
packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
packages/memento-core/src/infrastructure/database/database/migrate.ts
packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts
packages/memento-core/src/shared/utils/database.ts   # #749 cycle
packages/memento-core/.../batch-scheduler*           # #749 cycle
packages/memento-server/src/server/routes/tools.routes.ts
packages/memento-server/package.json
packages/memento-assistant/package.json
packages/memento-assistant/test/e2e/channel-isolation.e2e.spec.ts
packages/memento-client/src/client/search-client.ts  # 계약 참조용(변경 최소)
docs/agents/architecture.md                          # #749 정합 시
graphify-out/                                        # production 변경 PR만 재빌드
```

**Structure Decision:** 기존 npm workspaces monorepo 유지. 신규 패키지·프레임워크·분석기 디렉터리 추가 없음.

---

## PR strategy

- **1 child issue = 1 PR**. 순서: P0 `#752 → #754 → #750 → #755 → #751 → #756`, 이후 P1 `#753 → #749`.
- 본문 필수: `Fixes #<issue>` 및 `Part of #748`.
- 파일 충돌만 없으면 비인접 이슈 병렬 가능. `#755`와 `#753`은 동일 migrate/embedding 경로 → **직렬 권장**.
- `#752`와 `#750`은 export/pack 표면이 겹칠 수 있음 → export 변경은 최소·조율.
- 각 PR done: 대상 테스트 + `type-check` + `lint` (+ graphify if production).

---

## Open questions / decisions locked

| Topic | Locked decision |
|-------|-----------------|
| #752 agent-integration | **Bundle** via prepack/`bundledDependencies` 확장. 이 에픽에서 npm registry **publish 안 함**. |
| #752 externals | root deps에 `express-rate-limit` · `helmet` · `umap-js`; verify가 server closure 누락 시 fail. |
| #754 filters | Shared `executeTool`/HTTP 진입에서 nested `filters` **1회 flatten**; top-level MCP 호환. |
| #750 scripts | 등록된 root npm scripts만 수정; archive/unused 삭제; CLI smoke in CI. |
| #755 rebuild | `db.transaction` around create/copy/drop/rename only. |
| #751 nightly | Dedicated include **env/flag** (prefer over blanket `CI` unset); PR exclude kept; 0 tests = fail. |
| #756 audit | wanted-only bumps + `npm audit --omit=dev` in `security-check.yml`; document upstream-blocked; **no** ML force-override. |
| #753 metadata | Move `ensureMetadataDefaults` to bootstrap/migrate; remove hot-path calls; query-count required. |
| #749 architecture | Expand `dependency-boundaries.spec` + allowlist; break 2 cycles; **no** new analyzer dep. Re-confirm cycles at implement; docs claim **~L21**. |
| Frameworks | No new frameworks/abstractions/bundlers. |

**Still open (implement-time only, non-blocking for plan):**
- #752 empty-temp smoke에서 native rebuild(`better-sqlite3`/`sqlite-vec`) 범위를 gate vs 문서화 중 어디에 둘지.
- #756 구현 직전 live `npm audit` 수치 재측정(이슈 body 기준 wanted 목록은 고정).
- #749 allowlist 초기 스냅샷은 implement 시 AST/`rg`로 한 번 refresh.
