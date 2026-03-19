# Tasks: 네트워크 서비스 신뢰·보안 강화

**Input**: Design documents from `/specs/001-http-trust-security/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-security.md](./contracts/http-security.md), [quickstart.md](./quickstart.md)

**Tests**: 스펙 **FR-006** 및 성공 기준(SC-001~SC-003)에 따라 **자동 검증 작업을 포함**한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 미완료 작업과 파일 충돌 없이 병렬 가능
- **[USn]**: spec.md 사용자 스토리 매핑
- 경로는 리포지토리 루트 기준

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 환경·문서 기반 정렬

- [x] T001 Document `ADMIN_API_KEY`, `CORS_ALLOWED_ORIGINS`, `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN`(가칭, research R-1와 일치하도록 최종 이름 확정) 및 운영/로컬 주의사항 in `env.example`
- [x] T002 [P] Cross-check operator steps in `specs/001-http-trust-security/quickstart.md` against planned env names and add recovery note for misconfigured keys (spec edge cases)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 사용자 스토리 전에 완료해야 하는 설정·공유 유틸

**⚠️ CRITICAL**: 이 단계 완료 전까지 US1~US3 구현 착수 금지

- [x] T003 Extend `MementoConfig` and env resolution for insecure-admin opt-in (and optional HTTP bind host if introduced) in `packages/memento-core/src/shared/types/index.ts` and `packages/memento-core/src/shared/config/index.ts`
- [x] T004 [P] Add shared browser CORS allowlist helper (reflect allowed `Origin` or deny) in `packages/memento-server/src/server/utils/cors-policy.ts` using `mementoConfig.corsAllowedOrigins`

**Checkpoint**: 코어 설정과 서버 CORS 헬퍼 준비 완료

---

## Phase 3: User Story 1 - 민감 HTTP 기능 접근 통제 (Priority: P1) 🎯 MVP

**Goal**: 비루프백 노출 시 무자격으로 `/admin`, `/api`, `/api/v1/quality` 계열이 성공하지 않도록 한다.

**Independent Test**: 유효 키 없이 보호 대상 경로 호출 시 401(또는 서버 기동 거부); 유효 키로 2xx/업무적 4xx.

### Tests for User Story 1

- [x] T005 [P] [US1] Add integration tests: unauthenticated requests to protected routes fail under enforced policy in `packages/memento-server/src/server/admin-auth-security.integration.spec.ts` (or extend existing `http-server` integration spec)

### Implementation for User Story 1

- [x] T006 [US1] Enforce startup policy: non-loopback bind requires `ADMIN_API_KEY` unless insecure flag set; make listen host configurable (replace hardcoded `0.0.0.0` where appropriate) in `packages/memento-server/src/server/http-server.ts`
- [x] T007 [US1] Align `createAdminAuthMiddleware` behavior with research R-1 (fail-closed when exposed) in `packages/memento-server/src/server/middleware/admin-auth.middleware.ts`
- [x] T008 [P] [US1] Mirror listen host, startup guard, and admin-auth behavior in legacy `src/server/http-server.ts` and `src/server/middleware/admin-auth.middleware.ts`

**Checkpoint**: US1 단독으로 SC-001 방향 검증 가능

---

## Phase 4: User Story 2 - 브라우저 교차 출처 접근 최소화 (Priority: P2)

**Goal**: MCP/SSE 등에서 `Access-Control-Allow-Origin: *` 제거·정합; `CORS_ALLOWED_ORIGINS`와 동일 정책.

**Independent Test**: 허용 목록 밖 `Origin`으로 민감 응답이 크로스 오리진 노출되지 않음(샘플 시나리오).

### Tests for User Story 2

- [x] T009 [P] [US2] Add request-level tests for MCP/SSE CORS headers vs allowlist in `packages/memento-server/src/server/routes/mcp.routes.spec.ts` (create file if missing) or `packages/memento-server/src/server/simple-mcp-server.spec.ts`

### Implementation for User Story 2

- [x] T010 [US2] Replace ad-hoc `*` CORS headers with shared `cors-policy` helper in `packages/memento-server/src/server/routes/mcp.routes.ts`
- [x] T011 [P] [US2] Apply the same helper to SSE/CORS paths in `packages/memento-server/src/server/simple-mcp-server.ts`
- [x] T012 [P] [US2] Mirror MCP/simple-mcp CORS behavior under `src/server/routes/mcp.routes.ts` and `src/server/simple-mcp-server.ts`

**Checkpoint**: US2 단독 검증 가능; US1과 함께 운영 시나리오 강화

---

## Phase 5: User Story 3 - 품질 웹 보고서 안전 표시 (Priority: P2)

**Goal**: 품질 HTML에서 사용자 영향 문자열이 활성 콘텐츠로 실행되지 않음(SC-002).

**Independent Test**: 악성 `namespace`/`metric_key`/`context` 픽스처로 HTML에 `<script`, 이벤트 핸들러, 속성 탈출이 없음.

### Tests for User Story 3

- [x] T013 [P] [US3] Add Vitest cases with malicious strings for HTML report output in `packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-assurance-service.spec.ts` (and/or new `quality-reporter.spec.ts` beside `quality-reporter.ts`)

### Implementation for User Story 3

- [x] T014 [US3] Audit and harden all dynamic HTML insertions (escape + status/class allowlists) in `packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-reporter.ts`

**Checkpoint**: US3 단독 검증 가능

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 문서·품질 게이트·스펙 산출물 정합

- [x] T015 [P] Add operator-facing HTTP security section (env checklist, lockout recovery, link to `specs/001-http-trust-security/quickstart.md`) in `docs/ko/developer-guide.md` (or new `docs/ko/http-security.md` and link from developer guide)
- [x] T016 Run `npm run lint`, `npm run type-check`, and `npm test` from repository root `/home/jee1lee/git/memento` and fix any regressions introduced by this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** → **Phase 3 (US1)** → US2 / US3는 Phase 2 이후 **병렬 착수 가능**(다른 파일 위주)
- **Phase 6**: US1~US3 원하는 범위 완료 후

### User Story Dependencies

- **US1**: Phase 2 완료 후. 다른 스토리와 독립.
- **US2**: Phase 2 완료 후. US1과 **논리적 독립**(동시 개발 가능, 통합 검증은 둘 다 적용 후 권장).
- **US3**: Phase 2 완료 후. US1/US2와 **논리적 독립**(core 패키지).

### Within Each User Story

- US1: T005 테스트 추가 후 T006~T008 구현 권장(TDD)
- US2: T009와 T010~T012 병렬 일부 가능(T004 헬퍼 존재 전제)
- US3: T013·T014 상호 밀접 — 감사 후 테스트 보강 순 권장

### Parallel Opportunities

| Phase | Parallel tasks |
|-------|----------------|
| 1 | T002 [P] after T001 started (different files) |
| 2 | T004 [P] alongside T003 |
| 3 | T005 [P]; T008 [P] after T006~T007 behavior fixed in package |
| 4 | T009 [P]; T011 [P] with T010; T012 [P] |
| 5 | T013 [P] with prep work; T014 follows audit |
| 6 | T015 [P] before or parallel to T016 prep |

---

## Parallel Example: User Story 2

```bash
# After T004 exists:
# Developer A: T010 mcp.routes.ts + T011 simple-mcp-server.ts
# Developer B: T009 mcp.routes.spec.ts
# Developer C: T012 root src/server mirror
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1–2  
2. Complete Phase 3 (US1) including T005–T008  
3. **STOP**: Run targeted tests + `npm test` subset; demo unauthorized 401 / startup failure  

### Incremental Delivery

1. MVP (US1) → 배포/데모  
2. US2 → 브라우저 공격면 축소  
3. US3 → 품질 HTML XSS 회귀 방지  
4. Phase 6 → 문서·전체 게이트  

### Parallel Team Strategy

- 공동: Phase 1–2  
- 이후 A: US1, B: US2, C: US3 (코어/서버 파일 충돌 시 짧은 동기화)

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 16 (T001–T016) |
| Per story | US1: 4 tasks (T005 테스트 + T006–T008 구현); US2: 4 tasks (T009–T012); US3: 2 tasks (T013–T014) |
| Setup + Foundational | 4 tasks (T001–T004) |
| Polish | 2 tasks (T015–T016) |
| MVP scope | Phase 1–3 (T001–T008, T005 선행 권장) |

모든 작업 줄은 체크리스트 형식 `- [x] Tnnn ...` 및 **파일 경로 포함**을 만족하는지 확인할 것.

---

## Notes

- 구현 시 research.md R-1~R-4를 단일 진실 공급원으로 삼는다.  
- `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` 이름은 구현 PR에서 research·env.example·문서 일괄 정한다.  
- 루트 `src/server/*`가 배포에서 미사용이면 T008/T012를 “삭제 또는 packages만 유지” 결정으로 대체 가능 — 착수 전 `package.json` 빌드 진입점 확인.
