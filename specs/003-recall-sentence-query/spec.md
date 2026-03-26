# Feature Specification: Recall 검색 품질 개선 — 자연어 쿼리 + TF-IDF Fallback 경고

**Feature Branch**: `003-recall-sentence-query`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "recall 도구의 query 입력 방식을 키워드 분리에서 자연어 문장으로 변경하고, TF-IDF fallback 발생 시 명확한 경고를 추가한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 자연어 문장으로 기억 검색 (Priority: P1)

AI 에이전트가 `recall` 도구를 호출할 때 공백으로 구분된 키워드 목록 대신 자연어 문장("JWT 토큰이 만료됐을 때 어떻게 처리했는지 기억해줘")을 입력하면, 의미적으로 더 연관성 높은 기억을 반환받는다.

**Why this priority**: 검색 품질이 핵심 가치이며, 쿼리 방식 변경은 가장 직접적인 품질 개선 수단이다. MiniLM 등 신경망 임베딩 모델은 문맥이 있는 문장에서 더 정확한 벡터를 생성한다.

**Independent Test**: `recall` 도구에 자연어 문장을 입력했을 때, 동일한 키워드만 나열했을 때보다 의미적으로 관련성 높은 결과가 상위에 노출된다.

**Acceptance Scenarios**:

1. **Given** AI 에이전트가 "JWT 토큰 만료 처리 방법"이라는 기억을 저장한 상태에서, **When** `recall` 도구에 "인증 실패했을 때 토큰 갱신하는 방법이 궁금해"라는 문장을 입력하면, **Then** 해당 기억이 결과에 포함된다.
2. **Given** `recall` 도구의 `query` 파라미터 설명을 확인할 때, **When** 에이전트가 도구 스키마를 읽으면, **Then** "자연어 문장으로 입력하세요"라는 안내가 명시되어 있다.
3. **Given** AI 에이전트가 키워드 방식("auth token JWT expired")으로 쿼리를 입력해도, **When** 검색이 실행되면, **Then** 정상적으로 결과가 반환된다 (하위 호환 유지).

---

### User Story 2 - TF-IDF Fallback 발생 시 명확한 경고 (Priority: P2)

검색 품질이 낮은 TF-IDF 제공자로 자동 전환될 때, 운영자(시스템 로그를 보는 사람)가 명확히 인지할 수 있는 경고 메시지를 받는다.

**Why this priority**: TF-IDF fallback이 발생하면 검색 품질이 크게 저하되는데, 현재는 조용히 fallback되어 운영자가 인지하기 어렵다. 이를 가시화하면 문제를 빠르게 진단할 수 있다.

**Independent Test**: MiniLM이 실패하도록 환경을 구성한 뒤 `recall`을 호출했을 때, stderr에 TF-IDF fallback 경고 메시지가 출력되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** MiniLM 모델 로딩이 실패하는 상황에서, **When** `recall`이 TF-IDF로 fallback하면, **Then** stderr에 TF-IDF fallback과 검색 품질 저하 가능성을 알리는 경고가 출력된다.
2. **Given** `recall`이 TF-IDF로 fallback한 경우, **When** 응답 메타데이터를 확인하면, **Then** 실제 사용된 임베딩 제공자 정보가 포함된다.
3. **Given** MiniLM이 정상 동작하는 경우, **When** `recall`을 호출하면, **Then** TF-IDF 경고가 출력되지 않는다.

---

### User Story 3 - memory_injection 도구도 동일하게 개선 (Priority: P3)

`memory_injection` 도구의 `query` 파라미터도 자연어 문장 입력을 권장하도록 안내가 업데이트된다.

**Why this priority**: `recall`과 동일한 검색 경로를 사용하므로 일관성을 위해 함께 변경해야 하나, `recall` 대비 사용 빈도가 낮아 후순위이다.

**Independent Test**: `memory_injection` 도구 스키마의 `query` 설명이 자연어 문장 입력을 안내하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** `memory_injection` 도구의 스키마를 확인할 때, **When** `query` 파라미터 설명을 읽으면, **Then** 자연어 문장 입력을 권장하는 내용이 포함된다.

---

### Edge Cases

- 빈 문자열이나 공백만 있는 쿼리를 입력했을 때 기존과 동일한 오류 처리를 유지한다.
- 매우 긴 문장(임베딩 모델의 최대 토큰 한도 초과)을 입력했을 때 기존의 토큰 처리 방식을 따른다.
- 한글/영어 혼용 문장에서도 자연어 쿼리가 정상 동작한다.
- TF-IDF로 저장된 기존 기억과 MiniLM으로 저장된 기억이 혼재할 때 검색 결과가 정상적으로 반환된다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `recall` 도구의 `query` 파라미터 설명은 자연어 문장 입력을 명시적으로 권장해야 한다.
- **FR-002**: `memory_injection` 도구의 `query` 파라미터 설명도 자연어 문장 입력을 권장해야 한다.
- **FR-003**: `recall` 및 `memory_injection` 도구 실행 중 TF-IDF 제공자로 fallback이 발생할 때마다 운영 로그(stderr)에 경고 메시지를 출력해야 한다. `remember` 등 저장 흐름에서의 임베딩 fallback은 이 기능의 범위 밖이다.
- **FR-004**: TF-IDF fallback 경고 메시지에는 fallback 이유(원래 제공자 실패)와 품질 저하 가능성이 포함되어야 한다.
- **FR-005**: `recall` 응답 메타데이터에 실제 사용된 임베딩 제공자 정보가 포함되어야 한다.
- **FR-006**: 기존 키워드 방식 쿼리는 자연어 문장으로 변경 후에도 계속 동작해야 한다 (하위 호환 유지).

### Key Entities

- **Query**: `recall` 및 `memory_injection` 도구에 입력되는 검색 문자열. 자연어 문장 형태를 권장하며, 기존 키워드 방식도 허용.
- **Embedding Provider**: 쿼리 벡터화를 담당하는 제공자. 우선순위 순으로 선택되며 TF-IDF는 최후 수단으로만 사용.
- **Fallback Event**: 우선 제공자 실패로 인해 하위 제공자로 전환되는 사건. TF-IDF로의 전환은 품질 저하를 수반하므로 별도 경고 필요.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `recall` 및 `memory_injection` 도구 스키마의 `query` 파라미터 설명에 자연어 문장 입력 권장 안내가 포함된다.
- **SC-002**: TF-IDF fallback 발생 시 100%의 경우 stderr에 경고 메시지가 출력된다.
- **SC-003**: 기존 키워드 방식 쿼리로 작성된 테스트가 변경 후에도 모두 통과된다.
- **SC-004**: `recall` 응답 메타데이터에 실제 사용된 임베딩 제공자가 표시된다.
- **SC-005**: MiniLM이 정상 동작하는 환경에서 TF-IDF 경고가 출력되지 않는다.

## Clarifications

### Session 2026-03-24

- Q: TF-IDF fallback 경고의 발생 범위는? → A: `recall` 및 `memory_injection` 도구 레벨에서만 경고 (검색 맥락 한정, `remember` 등 저장 흐름 제외)

## Assumptions

- MiniLM은 이미 설치된 환경을 기본으로 한다. `EMBEDDING_PROVIDER=tfidf`를 강제 설정한 경우는 이 기능의 범위 밖이다.
- 쿼리 파라미터 설명 변경은 AI 에이전트의 호출 패턴을 변화시키는 주요 수단이다. 에이전트는 도구 스키마를 읽고 그에 맞게 입력을 조정한다고 가정한다.
- `recall` 응답 구조에 `embedding_provider` 필드를 추가하더라도 기존 소비자 코드와 하위 호환이 유지된다 (optional 필드로 추가).
- TF-IDF는 완전히 제거하지 않고 "절대 실패하지 않는 비상구"로 유지한다. 제거 여부는 별도 기능으로 검토한다.
