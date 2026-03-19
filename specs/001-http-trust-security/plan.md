# Implementation Plan: 네트워크 서비스 신뢰·보안 강화

**Branch**: `001-http-trust-security` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-http-trust-security/spec.md`

## Summary

원격에서 접근 가능한 Memento HTTP 서버의 **관리·API·품질** 기능에 대해 (1) **무인증 기본 노출을 제거**하고 비밀 키를 운영 기본으로 요구하며, (2) **MCP 등 잔여 `*` CORS**를 `CORS_ALLOWED_ORIGINS`와 정합시키고, (3) **품질 HTML 리포트**의 동적 필드를 전면 감사·보강(이스케이프·속성 allowlist)하고, (4) **통합 테스트·문서**로 FR-006/SC-001–004를 충족한다. 상세 결정은 [research.md](./research.md) 참조.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20, ES modules)  
**Primary Dependencies**: Express, `cors`, `@memento/core`, `better-sqlite3`  
**Storage**: 기존 SQLite(품질 메트릭/임계값); 신규 보안 전용 테이블 불필요  
**Testing**: Vitest (`npm test`, 패키지별 스펙)  
**Target Platform**: Linux/macOS/Windows 서버 프로세스; 브라우저 클라이언트(선택)  
**Project Type**: 모노레포 — 주요 변경 `packages/memento-server`, `packages/memento-core` (품질 리포터)  
**Performance Goals**: 인증·CORS는 요청당 O(1); 품질 HTML 생성은 기존과 동급 유지  
**Constraints**: 하위 호환 — 로컬 루프백·문서화된 플래그로 점진 전환  
**Scale/Scope**: 단일 프로세스 HTTP 서버; 경로 수 ~수십 개 수준

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

저장소 `.specify/memory/constitution.md`는 아직 플레이스홀더 상태이므로, **프로젝트 `AGENTS.md` 품질 게이트**를 준용한다.

| Gate | Status |
|------|--------|
| 변경 후 `npm run lint` 통과 | 필수 |
| 변경 후 `npm run type-check` 통과 | 필수 |
| 관련 단위·통합 테스트 추가/갱신 후 `npm test` 통과 | 필수 |
| 보안 관련 동작은 회귀 테스트로 고정 | 필수 |

**Post-design re-check**: Phase 1 산출물(research, data-model, contracts, quickstart)이 스펙 FR/SC와 정합. **위반 없음** — Complexity Tracking 불필요.

## Project Structure

### Documentation (this feature)

```text
specs/001-http-trust-security/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── http-security.md # Phase 1
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```text
packages/memento-server/src/server/
├── http-server.ts           # CORS, 라우트 마운트, listen 주소
├── simple-mcp-server.ts     # CORS 정책 정합
├── middleware/
│   └── admin-auth.middleware.ts  # 키 검증, 실패 시 401
└── routes/
    ├── mcp.routes.ts        # SSE 등 Access-Control 헤더
    ├── admin.routes.ts
    ├── api.routes.ts
    └── quality.routes.ts

packages/memento-core/src/
├── shared/config/index.ts   # ADMIN_API_KEY, CORS_ALLOWED_ORIGINS
└── domains/monitoring/services/quality-assurance/
    └── quality-reporter.ts  # HTML 이스케이프·속성 안전성

packages/memento-server/src/server/**/*.spec.ts
packages/memento-core/src/**/*.spec.ts
```

**Structure Decision**: 기능은 **memento-server**의 HTTP 표면과 **core**의 품질 리포트 생성에 집중; 루트 `src/server` 레거시 복제본이 있으면 동일 정책 동기화 여부를 구현 시 확인한다.

## Complexity Tracking

> 본 기능은 Constitution/AGENTS 게이트 위반이 없어 표를 생략한다.

## Phase 0: Research (complete)

- [research.md](./research.md)에 NEEDS CLARIFICATION 없이 결정 정리됨.

## Phase 1: Design & Contracts (complete)

- [data-model.md](./data-model.md) — 구성·품질 필드 규칙.
- [contracts/http-security.md](./contracts/http-security.md) — 보호 경로·자격·CORS·HTML 안전성 계약.
- [quickstart.md](./quickstart.md) — 운영자 온보딩.
- 에이전트 컨텍스트: `.specify/scripts/bash/update-agent-context.sh cursor-agent` 실행.

## Phase 2

`/speckit.tasks`로 `tasks.md` 분해(본 명령 범위 외).

## Implementation Notes (for tasks phase)

1. **Listen 주소 감지**: `server.listen` 호스트가 비루프백이면 `ADMIN_API_KEY` 필수(또는 명시적 insecure 플래그).
2. **admin-auth**: 키 미설정 시 동작을 스펙·research와 일치시키기.
3. **mcp.routes / simple-mcp-server**: `*` 제거 및 출처 반사 로직 공유(유틸 추출 권장).
4. **quality-reporter**: HTML 부분 전수 감사; `class`용 status 값 allowlist.
5. **env.example**: `ADMIN_API_KEY`, `CORS_ALLOWED_ORIGINS`, 신규 플래그 설명.
6. **테스트**: 무자격 401, CORS preflight, HTML 악성 문자열 픽스처.
