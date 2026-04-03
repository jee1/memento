# Implementation Plan: 기억 관계 그래프 뷰

**Branch**: `009-memory-graph-view` | **Date**: 2026-04-02 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/009-memory-graph-view/spec.md`

## Summary

기존 `memory_relation` + `kg_triple` 데이터를 기반으로 `/admin/graph` HTTP 엔드포인트를 추가하고, `static/graph.html` 정적 파일로 force-directed 관계 그래프 UI를 제공한다. 백엔드는 기존 `createRelationGraph(db)` + `KgTripleRepository`를 조합하여 nodes/edges JSON을 반환한다. 프론트엔드는 별도 빌드 없이 D3.js CDN을 사용하는 단일 HTML 파일로 구현한다.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+), ES modules  
**Primary Dependencies**: Express 4.x (기존), better-sqlite3 (기존), D3.js v7 (CDN, 프론트엔드 전용)  
**Storage**: SQLite (`memory_relation`, `kg_triple`, `memory_item` 테이블 — 읽기 전용, 스키마 변경 없음)  
**Testing**: vitest (기존) — 단위 테스트(그래프 데이터 변환 로직), 통합 테스트(HTTP 엔드포인트)  
**Target Platform**: Node.js 20+, 로컬호스트 어드민 서버  
**Project Type**: web-service (HTTP admin API + 정적 HTML)  
**Performance Goals**: 100노드 이하 그래프 3초 이내 렌더링 (SC-002), 필터 응답 2초 이내 (SC-004)  
**Constraints**: DB 스키마 변경 없음, 신규 npm 의존성 없음(D3는 CDN), 역방향 의존 금지  
**Scale/Scope**: 최대 500노드 제한, 단일 어드민 사용자 대상

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First Delivery | ✅ PASS | 테스트 먼저 작성 후 구현 |
| II. Backward Compatibility | ✅ PASS | 신규 엔드포인트 추가만, 기존 MCP 도구/API 변경 없음 |
| III. Schema & Migration Discipline | ✅ PASS | DB 스키마 변경 없음 (읽기 전용) |
| IV. Quality Gates | ✅ PASS | lint + type-check + test 통과 후 완료 |
| V. Observability | ✅ PASS | 기존 logger 패턴 유지, 엔드포인트 오류는 logger.error로 기록 |

**Post-Design Re-check**: Phase 1 설계 후 동일 — 신규 파일 추가만, 기존 코드 변경 최소화.

## Project Structure

### Documentation (this feature)

```text
specs/009-memory-graph-view/
├── plan.md              ✅ This file
├── research.md          ✅ Phase 0 output
├── data-model.md        ✅ Phase 1 output
├── contracts/           ✅ Phase 1 output
│   └── admin-graph-api.md
└── tasks.md             (Phase 2 — /speckit.tasks)
```

### Source Code (repository root)

```text
packages/memento-server/
├── src/
│   └── server/
│       └── routes/
│           ├── admin.routes.ts          # /admin/graph 라우트 추가
│           └── admin.routes.spec.ts     # graph 엔드포인트 테스트 추가
└── static/
    └── graph.html                       # 신규: force-directed 그래프 UI

packages/memento-server/src/server/
└── http-server.ts                       # /graph 라우트 등록 추가
```

**Structure Decision**: 기존 admin.routes.ts에 `/graph` 라우트를 추가하고, `static/graph.html`을 신규 생성한다. 별도 패키지나 모듈 신설 없이 기존 구조를 최대한 활용한다.

## Complexity Tracking

해당 없음 — Constitution 위반 없음.
