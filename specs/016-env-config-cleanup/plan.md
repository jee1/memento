# Implementation Plan: Environment Config Cleanup

**Branch**: `016-env-config-cleanup` | **Date**: 2026-04-14 | **Spec**: `/specs/016-env-config-cleanup/spec.md`  
**Input**: Feature specification from `/specs/016-env-config-cleanup/spec.md`

## Summary

환경변수 템플릿과 실제 사용 변수 간 불일치를 제거하고, 에이전트 환경변수 관리 경로를 단일 정책으로 정리한다.  
핵심은 `env.example`의 최신화, `services/agent` 환경설정 파일 역할 정합화, 보안 필수 변수 안내 강화, 그리고 운영/온보딩 혼선을 줄이는 문서/검증 기준 추가다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+ (문서 및 설정 파일 중심 변경)  
**Primary Dependencies**: npm workspaces, existing memento server/core/client packages (신규 의존성 없음)  
**Storage**: N/A (환경설정 파일과 문서 변경 중심)  
**Testing**: Vitest, npm scripts (`npm run lint`, `npm run type-check`, `npm test`)  
**Target Platform**: Linux/macOS/Windows 개발 환경 + Docker 기반 실행 환경  
**Project Type**: Monorepo library + server package  
**Performance Goals**: 환경설정 온보딩 완료 시간 단축(30분 이내), 설정 누락 0건  
**Constraints**: 기존 공개 계약(MCP/HTTP 동작) 비호환 변경 금지, 기존 사용자 환경값 파괴 금지  
**Scale/Scope**: 루트 환경설정 템플릿, 에이전트 환경설정 템플릿, 관련 안내 문서 및 검증 로직

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Test-First Delivery (MUST)**: 적용. 설정/문서 변경이지만 동작 영향 영역(로딩 경로/변수명 매핑)은 테스트 우선으로 보완한다.
- **II. Backward Compatibility (MUST)**: 적용. 기존 변수명 폐기 시 호환 안내 또는 fallback 규칙을 명시한다.
- **III. Schema and Migration Discipline (MUST)**: DB 스키마 변경 없음. N/A.
- **IV. Quality Gates (MUST)**: 구현 완료 전 `lint`, `type-check`, `test` 통과 필요.
- **V. Observability and Failure Isolation (SHOULD)**: 설정 누락 시 명확한 오류/경고 메시지 유지.

초기 게이트 결과: **PASS**

## Project Structure

### Documentation (this feature)

```text
specs/016-env-config-cleanup/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
env.example
services/
└── agent/
    ├── .env
    └── ... (agent runtime sources)

packages/
├── memento-server/
│   └── src/
└── memento-core/
    └── src/

docs/
└── guides/ (필요 시 환경설정 가이드 업데이트)
```

**Structure Decision**: 기존 모노레포 구조를 유지하고, 설정 파일/문서/테스트 보강만 수행한다.

## Phase 0: Research Plan

1. 루트 `.env`와 `env.example`의 불일치 항목 분류(공통, 에이전트 전용, 보안 민감).
2. `services/agent/.env`의 실제 사용 경로와 파일 역할 확인.
3. 보안 변수(`ADMIN_API_KEY`, insecure 옵션) 안내 문구의 최소 요건 확정.
4. 기존 사용자 호환을 위한 변수명 전환 전략(유지/별칭/문서화) 결정.

## Test-First Classification

- **Behavior-changing increments (full Red-Green-Refactor required)**:
  - 실행 경로별 `.env` 로딩 규칙 변경
  - 변수 매핑/우선순위 로직 변경
  - 보안 변수 필수 여부 판정 로직 변경
- **Documentation-only increments (constitution exception applicable)**:
  - 주석/가이드 문구 정비
  - 체크리스트 산출물 작성
  - 스펙/계획/태스크 정합성 문서 보완

## Phase 1: Design Outputs

1. `data-model.md`에 환경변수 정의/출처 정책/보안 주석 엔터티 정의.
2. `contracts/`에 설정 유효성 규칙(템플릿 일관성 계약) 문서화.
3. `quickstart.md`에 신규 기여자용 환경설정 검증 시나리오 작성.
4. 에이전트 컨텍스트 업데이트 스크립트 실행으로 현재 기술 컨텍스트 동기화.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
