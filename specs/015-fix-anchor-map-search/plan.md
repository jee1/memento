# Implementation Plan: 대시보드 앵커 맵 검색 안정화

**Branch**: `015-fix-anchor-map-search` | **Date**: 2026-04-14 | **Spec**: `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/spec.md`  
**Input**: Feature specification from `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/spec.md`

## Summary

GitHub 이슈 #150: `static/js/anchor-map.js`에서 `renderMap()`이 노드가 없을 때 조기 반환하면서 전역 `nodes`를 할당하지 않아 `undefined`인 채로 남고, 검색 성공 후 `highlightSearchResults()`가 `nodes.find(...)`를 호출하면서 TypeError가 난다.  
**접근**: (1) `nodes`/`links`를 항상 배열 불변식으로 유지(선언 시 빈 배열 + 조기 반환 시 동기화); (2) `highlightSearchResults`·`selectAnchorNode` 등 `nodes`에 의존하는 경로에 방어적 `Array.isArray` 검사를 추가해 이중 방어. MCP·HTTP API·DB 스키마는 변경하지 않는다.

## Technical Context

**Language/Version**: 브라우저 대상 ES5/ES2015+ 호환 자바스크립트(기존 `static/js/anchor-map.js` 스타일 유지); 저장소 기준 Node.js 20+는 서버·도구용.  
**Primary Dependencies**: D3.js(대시보드에서 CDN/번들로 로드), 기존 `mementoAdminFetch`/`fetch` 패턴 유지.  
**Storage**: N/A(클라이언트 메모리·DOM만; SQLite/스키마 변경 없음).  
**Testing**: 헌장 I에 맞춰 `tasks.md` **T000**에서 Vitest 기반 **자동 회귀 테스트를 먼저** 추가한다(현재 코드에서 실패·픽스 후 통과). 브라우저 동작은 `quickstart.md`로 보강하고, 완료 시 루트 `npm run lint`·`npm run type-check`·`npm test`(헌장 IV)로 스위트를 유지한다.  
**Target Platform**: Chromium/Firefox/Safari 최신 주류 브라우저에서 대시보드(`/dashboard`) 동작.  
**Project Type**: 모노레포 npm workspaces; 본 픽스는 `packages/memento-server`가 서빙하는 **정적 자산**(`static/js/`) 수정.  
**Performance Goals**: 검색 클릭 후 UI 프리즈 없음; 정량 p95는 스펙에서 계획 단계로 위임됨 → 본 변경은 예외 경로에서 조기 반환만 추가해 오버헤드 무시 가능 수준.  
**Constraints**: 공개 MCP 도구 계약·REST 검색 API 동작 변경 금지(헌장 II). DB 마이그레이션 없음(헌장 III).  
**Scale/Scope**: 단일 사용자 로컬/사내 대시보드; 앵커 맵 페이지 및 검색·하이라이트 경로만.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 원칙 | 평가 |
|------|------|
| I. Test-First | **T000**으로 Red 단계(실패하는 자동화 테스트 선행)를 충족한 뒤 T001–T004로 Green. IIFE/전역 스크립트라도 결함 재현을 최소 복제한 Vitest 테스트로 충족 가능. 수동 `quickstart.md`는 회귀 보강. |
| II. Backward Compatibility | `search_local` 요청/응답·MCP 계약 변경 없음. |
| III. Schema Discipline | 스키마·마이그레이션 없음. |
| IV. Quality Gates | 완료 전 `npm run lint`, `npm run type-check`, `npm test` 통과 필수. |
| V. Observability | 신규 서버 로그 의무 없음(스펙). 클라이언트 `console` 동작은 기존 수준 유지. |

**Post-design re-check**: 설계상 외부 계약·스키마 변경 없음. Test-First는 T000+T001–T004 순서로 정렬됨.

## Project Structure

### Documentation (this feature)

```text
specs/015-fix-anchor-map-search/
├── plan.md              # 본 파일
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
└── tasks.md             # /speckit.tasks
```

### Source Code (repository root)

```text
static/js/
└── anchor-map.js        # 앵커 맵 D3 시각화·검색 하이라이트 (주요 수정 파일)

packages/memento-server/
└── src/                 # 정적 파일 서빙 경로만 관련 (코드 변경은 보통 불필요)
```

**Structure Decision**: 변경은 `static/js/anchor-map.js` 중심. 빌드 파이프라인(`copy-assets` 등)이 동일 경로로 배포하는지 확인만 하면 됨.

## Complexity Tracking

> Constitution I (Test-First)와의 정렬

| Decision | Rationale | Follow-up (optional) |
|----------|-----------|------------------------|
| T000에서 재현 조건을 최소 복제한 Vitest 테스트를 먼저 둔다 | 결함 수정은 헌장상 Red-Green-Refactor 전면 적용; 전역 스크립트는 테스트에서 함수 추출·모의 객체로 최소 침습 | 헬퍼 분리·E2E 확대는 본 픽스 후 선택 |

## Phase 0 & 1 Outputs

| Artifact | Path |
|----------|------|
| Research | `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/research.md` |
| Data model | `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/data-model.md` |
| Contracts | `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/contracts/dashboard-anchor-map-search.md` |
| Quickstart | `/home/jee1lee/git/memento/specs/015-fix-anchor-map-search/quickstart.md` |

**Agent context**: `/home/jee1lee/git/memento/.specify/scripts/bash/update-agent-context.sh cursor-agent` 실행(계획 작성 후).

## Phase 2 (tasks)

`tasks.md`는 `/speckit.tasks`로 생성되었으며, 구현·검증 시 **단일 진실 원천**으로 유지한다(본 플랜은 Phase 0·1 산출물·계획 정리까지).
