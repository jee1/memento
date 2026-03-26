# Tasks: Recall 검색 품질 개선 — 자연어 쿼리 + TF-IDF Fallback 경고

**Input**: Design documents from `/specs/003-recall-sentence-query/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Organization**: User Story별로 독립적으로 구현·테스트 가능하도록 구성

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존성 없음)
- **[Story]**: 해당 User Story 레이블 (US1, US2, US3)

---

## Phase 1: Setup (환경 확인)

**Purpose**: 현재 빌드·테스트가 정상임을 확인하고 기준선을 수립

- [X] T001 현재 브랜치에서 `npm run type-check && npm run lint && npm test` 실행하여 기준 통과 확인

---

## Phase 2: Foundational (공통 선결 조건)

**Purpose**: US2에서 사용할 embedding provider 조회 메서드 추가 — US1·US3와 독립적이나 US2가 의존

**⚠️ CRITICAL**: T002는 Phase 4(US2) 시작 전에 완료 필요

- [X] T002 `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts`에 `getCurrentProviderName(): EmbeddingProvider | null` public 메서드 추가 (기존 `private currentProviderName` 필드 반환)

**Checkpoint**: T002 완료 후 US2 구현 시작 가능

---

## Phase 3: User Story 1 — 자연어 문장으로 기억 검색 (Priority: P1) 🎯 MVP

**Goal**: `recall` 도구의 `query` 파라미터 설명을 자연어 문장 입력 권장 방식으로 변경

**Independent Test**: `recall` 도구 스키마에서 `query.description`을 읽었을 때 "자연어 문장"이라는 표현이 포함되어 있는지 확인

### Implementation for User Story 1

- [X] T003 [US1] `packages/memento-core/src/domains/memory/tools/recall-tool.ts` 라인 407의 `query.description`을 다음으로 변경: `'검색할 내용을 자연어 문장으로 입력하세요 (예: \'지난번에 JWT 토큰 만료 처리한 방법이 뭐였지?\'). 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다. type이 core 또는 vault가 아닌 경우 필수이며, memory_types만 제공된 경우에도 query는 필수입니다.'`

**Checkpoint**: T003 완료 → `npm run type-check` 통과 → User Story 1 독립적으로 완료 가능

---

## Phase 4: User Story 2 — TF-IDF Fallback 경고 (Priority: P2)

**Goal**: `recall` 실행 중 TF-IDF로 fallback 시 stderr 경고 + 응답 메타데이터에 `embedding_provider` 추가

**Independent Test**: MiniLM 실패를 mock한 테스트에서 stderr 경고 출력 확인 및 `embedding_provider: 'tfidf'` 메타데이터 포함 확인

**⚠️ 선결 조건**: T002 완료 필요

### Implementation for User Story 2

- [X] T004 [US2] `packages/memento-core/src/domains/memory/tools/recall-tool.ts`의 `RecallResponseMetadata` 인터페이스(라인 86-97 근처)에 `embedding_provider?: string` 필드 추가 (주석: `/** 실제 사용된 임베딩 제공자. tfidf일 경우 품질 저하 가능성 있음 */`)
- [X] T005 [US2] `packages/memento-core/src/domains/memory/tools/recall-tool.ts`의 기존 `metadata.fallback_used` 할당 블록(라인 1070-1076 근처) 이후에 다음 로직 추가:
  - `context.services.embeddingService?.getCurrentProviderName()`으로 사용된 provider 조회
  - `metadata.embedding_provider = usedProvider` 설정
  - `usedProvider === 'tfidf'`이면 `process.stderr.write('⚠️ [Memento] TF-IDF fallback 활성화: 기본 임베딩 제공자 사용 불가. 의미 기반 검색 품질이 저하될 수 있습니다.\n')` 출력
- [X] T006 [US2] `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts`에 3개 테스트 케이스 추가:
  1. TF-IDF fallback 시 stderr에 경고 출력 (spy 사용)
  2. TF-IDF fallback 시 응답 메타데이터에 `embedding_provider: 'tfidf'` 포함
  3. MiniLM 정상 동작 시 TF-IDF 경고 미출력

**Checkpoint**: T004-T006 완료 → `npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` 통과 → User Story 2 완료

---

## Phase 5: User Story 3 — memory_injection 도구 개선 (Priority: P3)

**Goal**: `memory_injection` 도구의 `query` 파라미터 설명도 자연어 문장 입력 권장으로 변경

**Independent Test**: `memory_injection` 도구 스키마에서 `query.description`을 읽었을 때 "자연어 문장"이라는 표현이 포함되어 있는지 확인

**참고**: T003(US1)과 병렬 실행 가능 (다른 파일)

### Implementation for User Story 3

- [X] T007 [P] [US3] `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts` 라인 18-19의 Zod schema 변경: `z.string().describe('검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.')`
- [X] T008 [P] [US3] `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts` 라인 34-36의 JSON Schema `description` 변경: `'검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.'`
- [X] T009 [US3] `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts` handler 내 recall과 동일한 TF-IDF fallback 감지 로직 추가: `context.services.embeddingService?.getCurrentProviderName()`으로 provider 조회 → `tfidf`이면 `process.stderr.write('⚠️ [Memento] TF-IDF fallback 활성화: 기본 임베딩 제공자 사용 불가. 의미 기반 검색 품질이 저하될 수 있습니다.\n')` 출력
- [X] T010 [US3] `packages/memento-core/src/domains/memory/tools/__tests__/memory-injection-prompt.spec.ts` (또는 동등한 테스트 파일)에 TF-IDF fallback 시 stderr 경고 출력 + MiniLM 정상 동작 시 미출력 테스트 추가

**Checkpoint**: T007-T010 완료 → `npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/` 통과 → User Story 3 완료

---

## Phase 6: Polish & 품질 게이트

**Purpose**: 전체 변경 사항 최종 검증

- [X] T011 [P] `npm run lint -- --fix` 실행하여 스타일 자동 수정
- [X] T012 [P] `npm run type-check` 실행하여 전체 타입 오류 없음 확인
- [X] T013 `npm test` 실행하여 전체 테스트 통과 확인 (T011, T012 완료 후)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 즉시 시작
- **Phase 2 (Foundational)**: Phase 1 완료 후 → Phase 4(US2)를 블록
- **Phase 3 (US1)**: Phase 1 완료 후 (Phase 2와 병렬 가능)
- **Phase 4 (US2)**: Phase 2(T002) 완료 필요
- **Phase 5 (US3)**: Phase 1 완료 후 (Phase 3과 병렬 가능)
- **Phase 6 (Polish)**: 모든 US phase 완료 후

### User Story Dependencies

- **US1 (T003)**: 독립적 — T001 이후 바로 시작 가능
- **US2 (T004-T006)**: T002 완료 필요
- **US3 (T007-T008)**: 독립적 — T001 이후 바로 시작 가능, US1과 병렬 가능

### Parallel Opportunities

- T003(US1)과 T007-T008(US3)은 서로 다른 파일 → 완전 병렬
- T002(Foundational)와 T003(US1)/T007-T008(US3)도 서로 다른 파일 → 병렬 가능
- T011(lint), T012(type-check)은 동시 실행 가능

---

## Parallel Example

```bash
# Phase 1 완료 후 동시에 실행 가능:
Task T002: unified-embedding-service.ts에 getCurrentProviderName() 추가
Task T003: recall-tool.ts query 설명 변경
Task T007: memory-injection-prompt.ts Zod query 설명 변경
Task T008: memory-injection-prompt.ts JSON Schema query 설명 변경

# T002 완료 후:
Task T004: RecallResponseMetadata에 embedding_provider 추가
Task T005: recall-tool.ts TF-IDF 감지 로직 추가
Task T006: recall-tool.spec.ts 테스트 추가
```

---

## Implementation Strategy

### MVP First (User Story 1만)

1. T001 → T003 → `npm run type-check`
2. **STOP and VALIDATE**: query 설명 변경 확인
3. 필요 시 바로 배포 가능 (단순 문자열 변경)

### Incremental Delivery

1. T001 → T003 → MVP (US1 완료)
2. T002 → T004 → T005 → T006 → US2 완료 (경고 기능 추가)
3. T007 → T008 → T009 → T010 → US3 완료 (memory_injection 일관성)
4. T011 → T012 → T013 → 릴리스 준비

---

## Notes

- 모든 변경은 `packages/memento-core` 패키지 내에 한정됨
- DB 스키마 변경 없음 — `npm run db:migrate` 불필요
- `embedding_provider` 필드는 optional → 하위 호환 유지
- TF-IDF 경고는 `process.stderr.write()` 사용 (MCP 프로토콜 준수)
