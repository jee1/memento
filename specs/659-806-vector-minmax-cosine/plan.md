# Implementation Plan: 벡터 유사도 절대 척도 복원 (#806)

**Branch**: `659-806-vector-minmax-cosine` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/659-806-vector-minmax-cosine/spec.md`

## Summary

벡터 검색 채널이 반환하는 유사도를 결과셋에 의존하지 않는 절대 cosine 척도로 되돌린다. 교정 대상은 두 곳이다. 정상 경로는 제공자별 결과셋의 최소·최대로 점수를 다시 늘려 최상위가 항상 1.0이 되고, 대체 경로는 거리값을 유사도 필드에 담아 방향이 반대다. 두 결함 모두 "거리→유사도 변환 규칙이 경로마다 따로 구현되어 있다"는 하나의 원인에서 나오므로, 변환 규칙을 공용 위치 한 곳으로 모으고 각 경로가 그것만 쓰게 한다. 임계값 숫자·가중치·보충 활성 여부는 동결하고, 점수 산출 방식이 바뀐 사실은 랭킹 버전 식별자와 기준 문서에 남긴다.

## Technical Context

**Language/Version**: TypeScript 5.x (ES modules), Node.js 24+
**Primary Dependencies**: better-sqlite3, sqlite-vec (vec0 가상 테이블, `distance_metric=cosine`)
**Storage**: SQLite. `memory_item` + 제공자별 `memory_item_vec_{tfidf,minilm,openai,gemini,mock}` (legacy 384 공용 `memory_item_vec` 포함). **이번 작업에서 스키마 변경 없음**
**Testing**: Vitest (`npm test`), 아키텍처 경계 테스트 포함
**Target Platform**: Node.js 서버(MCP stdio/HTTP), Linux/macOS
**Project Type**: npm workspaces 모노레포 — 변경은 `packages/memento-core` 단일 패키지에 국한
**Performance Goals**: 성능 목표 변경 없음. 재조정 제거는 결과당 연산을 줄이기만 하고 질의 횟수·프리페치 한도·제공자 병렬 구조를 바꾸지 않는다
**Constraints**: 임계값(0.38)·프리페치 배수·보충 활성 여부·랭킹 가중치 동결(FR-015). 커밋되는 검증 픽스처는 합성만. 보안·권한 범위 변경 없음(FR-022)
**Scale/Scope**: 프로덕션 코드 4개 지점(공용 변환 유틸 신설, 임베딩 서비스 매퍼, 하이브리드 벡터 실행 지점, 랭킹 버전 payload) + 문서 1건 + 신규/보강 검증

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery: failing tests precede implementation (Red-Green-Refactor). N/A only under the structural-refactoring exception. | I (MUST) | PASS | 결함 수정이므로 예외 대상 아님. 각 단계는 실패하는 검증부터 작성한다. Phase 1의 첫 단계(공용 변환 추출)만 동작 변경이 없는 리팩터이며, 기존 변환 검증이 green baseline 역할을 한다 |
| Backward compatibility of MCP tool contracts and stable API behavior; unavoidable breaks carry migration and compatibility notes in spec/plan/tasks. | II (MUST) | PASS | 응답 필드 이름·타입·0~1 범위 불변(FR-021). 값 분포는 달라지며 이는 불가피한 동작 변경이므로 호환성 노트를 이 계획의 "Compatibility Notes"와 기준 문서에 기록한다(FR-019) |
| Schema changes ship with migration files and synchronized schema artifacts and type definitions. | III (MUST) | N/A | 스키마·마이그레이션 변경 없음. vec 테이블 정의와 차원은 그대로다 |
| Quality gates before completion: `npm run lint`, `npm run type-check`, `npm test` pass; production-code changes also rebuild graphify and confirm `graphify-out/GRAPH_REPORT.md`. | IV (MUST) | PASS | 프로덕션 코드를 건드리므로 graphify 재빌드까지 포함한다. `graphify-out/`은 커밋하지 않는다 |
| Operational failures are observable via structured logs and degrade gracefully without breaking primary response paths. | V (SHOULD) | PASS | 기존 검색 단계 로깅을 유지한다. 신규 관측 신호는 도입하지 않기로 명세에서 결정(Q10). 대체 경로의 graceful degradation 구조 자체는 변경하지 않는다 |
| Additional Constraints: Node.js 24+ / TypeScript ESM, npm workspaces, security/auth scope changes specified explicitly, no non-redistributable corpora or derived data committed (LoCoMo CC BY-NC). | Additional Constraints | PASS | 검증 픽스처는 합성만 사용(Q15). 격리·프라이버시 필터 구성은 변경하지 않으며 무변경을 검증으로 고정한다(FR-022, SC-016) |

## Compatibility Notes (Principle II)

- **바뀌지 않는 것**: MCP `recall` 응답의 점수 필드 이름·타입·0~1 범위, 결과 항목의 필드 구성, 임계값·가중치 설정값, 스키마.
- **바뀌는 것**: 벡터 점수의 값 분포. 지금까지 최상위 결과는 제공자별 결과셋에서 항상 1.0에 가까웠으나, 교정 후에는 실제 근접도를 반영한 절대값이 된다. 최종 순위와 결합 점수도 함께 달라진다.
- **호출자 영향**: 낮아진 숫자는 정상이며 해석 기준이 달라진 것이다. 기준 문서(`docs/agents/search-ranking.md`)에 척도 변경 시점과 기대 해석을 기록한다.
- **기록 분리**: 랭킹 버전 식별자에 점수 척도 규정을 포함시켜, 교정 전후 검색 기록이 같은 실험 단위로 섞이지 않게 한다(FR-023).

## Project Structure

### Documentation (this feature)

```text
specs/659-806-vector-minmax-cosine/
├── plan.md              # This file
├── spec.md              # Feature specification (brainstorm 6세션 반영)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── vector-similarity-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit.tasks 산출물 (이 명령에서 만들지 않음)
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── shared/
│   └── utils/
│       ├── clamp.ts                                  # 기존 clamp01
│       └── vector-similarity.ts                      # 신설: 거리→유사도 단일 정의
├── shared/config/
│   └── ranking-weights-loader.ts                     # 랭킹 버전 payload에 척도 규정 추가
└── domains/
    ├── memory/services/
    │   └── memory-embedding-service.ts               # 대체 경로 매퍼: 방향 통일
    └── search/
        ├── algorithms/
        │   ├── hybrid-vector-search-executor.ts      # 제공자별 min-max 제거
        │   └── search-result-combiner.ts             # 코드 변경 없음, 검증만 추가
        └── repositories/vector-search/
            └── vector-search-result-mapper.ts        # 공용 정의를 사용하도록 전환

docs/agents/search-ranking.md                         # 척도 변경 시점·해석 기준 기록
```

**Structure Decision**: 기존 모노레포 구조를 그대로 사용한다. 새 디렉터리를 만들지 않고, 새 파일은 공용 변환 유틸 1개뿐이다. 이 유틸을 `shared/utils`에 두는 이유는 임베딩 도메인과 검색 도메인이 모두 의존해야 하는데 도메인 간 직접 의존을 늘리지 않기 위해서다.

## Phased Implementation Strategy

각 단계는 실패하는 검증을 먼저 작성한다(Principle I). 단계 간 파일 충돌이 없도록 지점별로 분리했다.

### Phase 1 — 변환 규칙 단일화 (동작 변경 없음)

- 거리→유사도 변환(`clamp(1 − distance, 0, 1)`, 비유한값은 0)을 `shared/utils/vector-similarity.ts`로 옮긴다.
- 기존 저장소 매퍼는 이 정의를 사용하도록 바꾸고 재노출한다. 기존 변환 검증이 그대로 통과해야 한다(green baseline).
- **요구사항**: FR-020 / **판정**: SC-014

### Phase 2 — 대체 경로 방향 통일

- 대체 경로 질의가 근접도를 한 방향으로만 노출하도록 정리한다. 결과 객체에 방향이 다른 두 필드가 동시에 존재하지 않게 한다.
- 매퍼는 Phase 1의 공용 정의만 사용한다.
- 검증은 벡터 인덱스 가용 여부를 "사용 불가"로 주입해 오류 없이 대체 경로를 실행시킨다.
- **요구사항**: FR-011, FR-016, FR-024 / **판정**: SC-010(제공자 기준), SC-011, SC-018

### Phase 3 — 제공자별 결과셋 재조정 제거

- 하이브리드 벡터 실행 지점에서 제공자별 최소·최대 재조정을 제거한다. 중복 제거는 절대 유사도의 최댓값으로 수행하고(FR-007), 반환 직전 범위·유한성 보장을 명시적으로 유지한다(FR-017).
- 임계값 판정이 재조정보다 앞선다는 순서 계약을 검증으로 고정한다(FR-005).
- 보충 후보가 자기 절대 점수를 유지하는지 확인한다(FR-006).
- **요구사항**: FR-001~FR-007, FR-012, FR-017 / **판정**: SC-001~SC-004, SC-006, SC-012

### Phase 4 — 표시·설명 문구 검증

- 결합 경로의 설명 문구는 이미 절대 기준으로 판정하고 있으며, 입력이 재조정된 값이었을 뿐이다. **따라서 이 단계는 코드 변경 없이 검증만 추가한다.** 무관한 쿼리에서 "의미적 유사도 높음" 취지의 문구가 붙지 않는지 확인한다.
- 벡터 단독 결과의 설명 숫자와 점수 필드 일치도 함께 고정한다.
- **요구사항**: FR-009, FR-018 / **판정**: SC-005, SC-013

### Phase 5 — 실험 식별자와 기록

- 랭킹 버전 payload에 점수 척도 규정을 포함시켜 교정 전후 식별자가 달라지게 한다. 임계값·가중치 값은 건드리지 않는다.
- 기준 문서에 척도 변경 시점과 해석 기준을 기록한다.
- **요구사항**: FR-013, FR-019, FR-023 / **판정**: SC-009, SC-017

### Phase 6 — 비회귀 확인

- 격리·프라이버시 필터 구성이 교정 전후 동일한지 확인한다(FR-022, SC-016).
- 앵커 슬롯 동작과 기존 하이브리드 검증이 모두 통과하는지 확인한다(SC-007, SC-008).
- 품질 게이트 실행: `npm run lint`, `npm run type-check`, `npm test`, graphify 재빌드 후 `graphify-out/GRAPH_REPORT.md` 확인.

## Constitution Re-check (post-design)

Phase 0·1 산출물을 만든 뒤 다시 평가했다. **여섯 게이트의 판정이 모두 그대로다.**

- 설계에서 새로 생긴 것은 공용 변환 유틸 파일 1개뿐이며, 새 의존성·새 계층·새 추상화를 도입하지 않았다.
- 스키마·마이그레이션은 여전히 해당 없음(Principle III N/A 유지).
- 설계 과정에서 확인한 프라이버시 범위 필터의 채널 간 비대칭은 **범위 밖**으로 유지했다. 보안·권한 범위 변경은 명시적 명세를 요구하므로(Additional Constraints), 이번 작업은 구성을 바꾸지 않고 무변경을 검증으로 고정한다.
- 검증 픽스처는 합성만 사용하므로 코퍼스 라이선스 제약을 위반하지 않는다.

**에이전트 컨텍스트 파일 참고**: `update-agent-context.sh claude`는 저장소 루트 `CLAUDE.md`에 기술 스택 블록을 덧붙였으나, 이 저장소는 `CLAUDE.md`를 `AGENTS.md`로 넘기는 포인터 파일로만 관리한다. 저장소 규약이 우선하므로 해당 변경은 되돌렸고, 같은 내용은 이 계획의 Technical Context에 있다.

## Complexity Tracking

> Constitution Check에 위반이 없으므로 비워 둔다.
