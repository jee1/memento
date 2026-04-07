# Implementation Plan: Security Hardening for Docker and HTTP Admin

**Branch**: `011-docker-security-hardening` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/011-docker-security-hardening/spec.md`

## Summary

Docker 컨테이너 및 HTTP admin API의 보안 취약점 4건을 수정한다: (1) `docker-compose.base.yml`에서 hardcoded insecure bypass flag 제거, (2) `docker-compose.yml`의 `user: root` 제거, (3) admin auth 미들웨어를 fail-open에서 fail-closed로 변경, (4) Express 앱에 helmet.js 기반 HTTP 보안 헤더 적용. 변경 범위는 최소화하며 기존 동작을 깨지 않는다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+, ES modules  
**Primary Dependencies**: Express 4.x (현재 5.x beta 사용 중), helmet.js v7+ (신규), cors, better-sqlite3  
**Storage**: SQLite (better-sqlite3) — 스키마 변경 없음  
**Testing**: vitest, 기존 테스트 suite  
**Target Platform**: Docker (Linux), loopback + non-loopback HTTP 서버  
**Project Type**: MCP server (HTTP + stdio)  
**Performance Goals**: 보안 헤더는 응답 레이턴시에 영향 없음 (≤1ms per request overhead)  
**Constraints**: 신규 npm 패키지는 helmet.js만 허용; TypeScript strict mode 유지; 기존 테스트 pass 유지  
**Scale/Scope**: 4개 파일 수정, 1개 신규 패키지 추가, 테스트 추가

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitution Rule | Status | Notes |
|-------------------|--------|-------|
| I. Test-First Delivery | PASS (planned) | admin-auth 미들웨어 변경에 대한 failing test 먼저 작성 필요 |
| II. Backward Compatibility | PASS with migration note | MEMENTO_ALLOW_INSECURE_HTTP_ADMIN 제거는 intentional breaking change; FR-008 migration note 필수 |
| III. Schema/Migration Discipline | N/A | DB 스키마 변경 없음 |
| IV. Quality Gates Before Completion | PASS (planned) | npm run lint, type-check, test 모두 통과 필요 |
| V. Observability | PASS (planned) | FR-003: ADMIN_API_KEY 미설정 시 startup warning 로그 추가 |

**No violations found.** Complexity Tracking 섹션 불필요.

## Project Structure

### Documentation (this feature)

```text
specs/011-docker-security-hardening/
├── plan.md              # This file (speckit.plan output)
├── research.md          # Phase 0 output (speckit.plan)
└── tasks.md             # Phase 2 output (speckit.tasks — NOT created by speckit.plan)
```

### Source Code (affected files)

```text
# Docker 설정
docker-compose.base.yml           # MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true" 줄 제거
docker-compose.yml                # user: root 줄 제거

# HTTP 서버 패키지
packages/memento-server/
├── package.json                  # helmet 의존성 추가
└── src/server/
    ├── http-server.ts            # app.use(helmet()) 추가 (CORS 등록 전)
    └── middleware/
        └── admin-auth.middleware.ts  # fail-open → fail-closed (line 15 수정)

# 테스트 (Constitution I: Test-First)
packages/memento-server/src/server/middleware/
└── admin-auth.middleware.spec.ts  # 신규 또는 기존 파일에 failing test 추가
```

**Structure Decision**: 단일 패키지 수정 (Option 1 변형). monorepo 구조 유지. 신규 파일은 테스트 파일 1개만 추가될 수 있음.

---

## Phase 0: Research

**Status**: COMPLETE — `research.md` 참조

### 핵심 발견사항 요약

1. **docker-compose.base.yml**: `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` 줄을 삭제하면 됨. opt-in 문법으로 교체하지 않고 제거 (FR-001 + clarification 일치).
2. **docker-compose.yml**: `user: root` 줄 삭제. Dockerfile에서 정의된 memento 유저(UID 1001)로 실행됨.
3. **admin-auth.middleware.ts**: line 15 `next()` → 401 응답 (fail-closed). whitespace trim 추가.
4. **helmet.js**: 미설치 상태. `npm install helmet --workspace=packages/memento-server` 필요. v7+는 자체 TypeScript 타입 포함 (`@types/helmet` 불필요).
5. **적용 위치**: `http-server.ts`에서 `app.use(cors(...))` 직전에 `app.use(helmet())` 등록.

---

## Phase 1: Design & Contracts

### 1.1 데이터 모델 변경

**없음.** 이번 픽스는 모두 미들웨어/설정 레벨 변경이며 DB 스키마 변경이 없다.

### 1.2 API 계약 변경 (Breaking Changes)

#### Admin Auth Behavior Change (FR-002)

| 조건 | 이전 동작 | 변경 후 동작 |
|------|-----------|-------------|
| `ADMIN_API_KEY` 미설정 | 200 OK (통과) | **401 Unauthorized** |
| `ADMIN_API_KEY=""` | 200 OK (통과) | **401 Unauthorized** |
| `ADMIN_API_KEY="   "` (whitespace only) | 200 OK (통과) | **401 Unauthorized** |
| `ADMIN_API_KEY=<valid>`, 올바른 키 제공 | 200 OK | 200 OK (변경 없음) |
| `ADMIN_API_KEY=<valid>`, 잘못된 키 제공 | 401 | 401 (변경 없음) |

**401 응답 페이로드 (키 미설정 시)**:
```json
{
  "error": "Unauthorized",
  "message": "Admin API is disabled: ADMIN_API_KEY is not configured. Set ADMIN_API_KEY environment variable to enable admin access.",
  "timestamp": "<ISO8601>"
}
```

#### Docker Compose Breaking Change (FR-001, FR-008)

`docker-compose.base.yml`에서 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` 제거는 기존 이 파일을 사용한 모든 배포에 대한 breaking change이다.

**Migration Path**:
- 기존에 base 설정 의존 → `ADMIN_API_KEY` 환경변수 설정 필요
- 로컬 개발에서 escape hatch 유지 원하면 `docker-compose.override.yml`에 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` 추가 (커밋 금지)

### 1.3 HTTP 보안 헤더 목록 (FR-005)

Helmet.js v7+ 기본 설정으로 적용. 최소 필수 헤더:

| 헤더 | 값 | 구현 방법 |
|------|----|-----------|
| `X-Frame-Options` | `SAMEORIGIN` (helmet default) / 스펙은 DENY | `helmet({ frameguard: { action: 'deny' } })` |
| `X-Content-Type-Options` | `nosniff` | helmet default |
| `Content-Security-Policy` | `default-src 'self'` | helmet default (단, 대시보드 CDN 리소스 있으면 조정 필요) |
| `Referrer-Policy` | `no-referrer` | helmet default (`strict-origin-when-cross-origin`이 default이므로 명시 필요) |

**주의**: 스펙은 `X-Frame-Options: DENY`를 명시. Helmet 기본값은 `SAMEORIGIN`. `frameguard({ action: 'deny' })`로 명시 필요.  
**주의**: Helmet CSP default가 대시보드(D3.js CDN) 로드를 차단할 수 있음. tasks.md에서 CSP 상세 검토 필요.

### 1.4 시작 경고 로그 (FR-003)

`packages/memento-server/src/server/http-server.ts`의 `startServer()` 함수에 추가:

```typescript
// ADMIN_API_KEY 미설정 시 loopback 바인딩이어도 warning 출력 (FR-003)
if (!mementoConfig.adminApiKey || mementoConfig.adminApiKey.trim() === '') {
  logger.warn(
    'ADMIN_API_KEY is not configured: all admin API requests will be rejected with 401. ' +
    'Set ADMIN_API_KEY environment variable to enable admin access.'
  );
}
```

기존 `getMementoHttpSecurityStartupViolationMessage`는 non-loopback 바인딩 + 키 미설정 조합만 처리하므로 위 코드는 중복 없이 추가됨.

---

## Phase 2: Implementation (Tasks Overview)

> **상세 작업 항목은 `/speckit.tasks` 명령으로 `tasks.md` 생성 시 정의됨**

### Task 그룹 예상

| 그룹 | 내용 | FR 연결 |
|------|------|---------|
| T1: Docker Config | base/yml에서 insecure flag 및 root user 제거 | FR-001, FR-004 |
| T2: Admin Auth Middleware (TDD) | failing test → fail-closed 구현 → passing | FR-002, FR-003 |
| T3: HTTP Security Headers | helmet 설치, http-server.ts에 등록 | FR-005, FR-006 |
| T4: Startup Warning | http-server.ts에 ADMIN_API_KEY warning 로그 | FR-003 |
| T5: Migration Note | CHANGELOG 또는 docs에 breaking change 문서화 | FR-008 |
| T6: Quality Gates | lint, type-check, test 모두 통과 | Constitution IV |

### 구현 순서 (의존 관계)

```
T1 (Docker) ─┐
T2 (Auth)   ─┤─→ T6 (Quality Gates)
T3 (Helmet) ─┤
T4 (Warning)─┘
T5 (Migration note) — 독립, 언제든 작성 가능
```

T1~T4는 병렬 작업 가능 (파일 간 충돌 없음). T6는 T1~T4 완료 후.

---

## Migration Notes (FR-008)

### Breaking Change: MEMENTO_ALLOW_INSECURE_HTTP_ADMIN 제거

이전에 `docker-compose.base.yml`을 통해 배포했다면 이 변경으로 admin 엔드포인트 접근이 차단된다.

**영향받는 배포**: `docker-compose.base.yml` 또는 이를 `extends`하는 `docker-compose.yml` 사용 배포

**복구 방법**:
1. `ADMIN_API_KEY=<secret>` 환경변수 설정 (권장)
2. 로컬 개발 전용: `docker-compose.override.yml`에 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` 추가 (절대 커밋 금지)

**이스케이프 해치 유지**: `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` 환경변수와 코드 레벨 지원은 제거되지 않는다. 단, base compose 파일에서 hardcoded 활성화를 제거할 뿐이다.
