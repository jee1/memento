# 이슈 #20 — SPECIFY (명세)

SDD **Specify** 단계 산출물 2/2. 요구사항(REQ)·제약(CON)·수용 기준(AC) 및 유스케이스 명세.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 중복 제거 및 기억 압축 (반복 보존 정책) |
| **문서 유형** | SPECIFY (구현 명세) |
| **버전** | 1.0 |
| **날짜** | 2026-03-14 |
| **상태** | draft |
| **관련 이슈** | [#20](https://github.com/jee1/memento/issues/20) |
| **요구사항 문서** | [requirements.md](./requirements.md) |
| **설계 문서** | [design.md](./design.md) |
| **논의 요약** | [2026-03-14-issue-20-memory-vs-storage-discussion.md](../2026-03-14-issue-20-memory-vs-storage-discussion.md) |

---

## 1. 범위

### 1.1 In scope

- 유사 기억 탐지·병합 시 **반복 정보(num_times, last_mentioned_at) 보존**.
- 병합된 대표 항목에 대한 **num_times 누적**, **last_mentioned_at 갱신**.
- recall/검색 랭킹에서 **num_times·last_mentioned_at 기반 boost** 적용(또는 #88 구현과 연동).
- #89 비동기 Augmentation 워커 또는 #90 dedupe와의 **정책·위치 통합** (병합 로직이 워커/dedupe 파이프라인에 포함됨).

### 1.2 Out of scope

- Triple/KG 전용 dedupe 스키마·로직 자체(#90 범위). 본 명세는 **memory_item 단위 병합 + 반복 메타 보존**에 한정.
- #88 Fact 메타데이터 스키마·마이그레이션 구현(#88 범위). 본 명세는 #88에 **num_times, last_mentioned_at**이 있다고 가정하고, 그 필드를 **사용·갱신**하는 요구사항만 둠.
- 에이전트/사용자에게 노출되는 새 MCP 도구 또는 CLI 옵션. (기존 remember/recall 동작 확장 또는 백그라운드 워커 동작.)

---

## 2. 기능 요구사항

### 2.1 병합 정책

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-MERGE-1 | 유사 기억을 대표 1건으로 병합할 때 **반복 정보를 삭제하지 않고** 대표 항목의 메타데이터에 반영한다. | 병합 후 대표 항목에 num_times ≥ 병합된 총 건수(또는 기존 값 + (N-1)), last_mentioned_at = 병합 집합 중 최신 시각. |
| REQ-MERGE-2 | 병합 시 대표 항목의 **num_times**를 누적(또는 증가)하고, **last_mentioned_at**을 최신 언급 시각으로 갱신한다. | 스키마에 num_times, last_mentioned_at이 있을 때 갱신 로직이 적용됨. |
| REQ-MERGE-3 | (선택) 병합된 원본 N건은 **soft-delete** 또는 **대표 ID 참조**로 보존할 수 있다. | 감사·디버깅 시 “어떤 항목들이 하나로 묶였는지” 조회 가능. |

### 2.2 recall/랭킹

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-RECALL-1 | recall·검색 시 **num_times**(및 필요 시 last_mentioned_at)를 랭킹·boost에 반영하여, 반복된 기억이 더 잘 회수되도록 한다. | #88 boost 공식 또는 동등한 랭킹 로직에서 num_times·last_mentioned_at 사용. |
| REQ-RECALL-2 | 반복 보존이 적용된 대표 항목은, 동일 쿼리에서 **num_times가 0인 항목보다** 동등 조건일 때 더 높은 순위 후보가 될 수 있다. | 수용 기준(AC)으로 검증. |

### 2.3 파이프라인 통합

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-PIPE-1 | 중복 제거·병합 로직은 **#89 비동기 Augmentation 워커** 또는 **#90 dedupe** 파이프라인에 통합 가능한 형태로 설계된다. | 워커/파이프라인 문서·코드에서 “병합 시 num_times·last_mentioned_at 갱신”이 명시됨. |
| REQ-PIPE-2 | #88 Fact 메타(num_times, last_mentioned_at)가 스키마에 반영된 뒤, 본 기능은 해당 컬럼을 읽고 쓴다. | #88 마이그레이션 완료 후 본 기능 구현·통합. |

---

## 3. 유스케이스 명세

### UC-1: 유사 기억 탐지 및 대표 선정

| 항목 | 내용 |
|------|------|
| **액터** | 백그라운드 워커(또는 dedupe 파이프라인) |
| **전제 조건** | memory_item에 유사도·그룹핑 기준(예: 임베딩 유사도, 텍스트 정규화)이 정의됨. |
| **기본 흐름** | 1) 워커가 대상 풀에서 유사 기억 그룹을 탐지한다. 2) 그룹 내에서 대표 1건을 선정한다(예: 최신·가장 높은 importance·첫 생성 등 정책에 따름). 3) 나머지 N-1건을 병합 대상으로 표시한다. |
| **결과** | 대표 ID 1개, 병합 대상 ID 목록 N-1개. |

### UC-2: 병합 시 반복 메타데이터 갱신

| 항목 | 내용 |
|------|------|
| **액터** | 백그라운드 워커 |
| **전제 조건** | UC-1 완료. 대표 항목 및 병합 대상 목록 확정. memory_item에 num_times, last_mentioned_at 컬럼 존재(#88). |
| **기본 흐름** | 1) 대표 항목의 num_times를 (기존 값 + 병합 대상 건수) 또는 (병합 집합 전체 건수)로 갱신한다. 2) last_mentioned_at을 병합 집합 중 최신 created_at 또는 last_accessed로 갱신한다. 3) (선택) 병합 대상 N-1건을 soft-delete 하거나 merged_into_id = 대표 ID로 갱신한다. |
| **결과** | 대표 항목만 물리적으로 “내용”을 유지하고, 반복 정보는 메타데이터로 보존됨. |

### UC-3: recall 시 반복 기반 랭킹 반영

| 항목 | 내용 |
|------|------|
| **액터** | recall/검색 엔진, 사용자·에이전트 |
| **전제 조건** | #88 boost 공식 또는 랭킹 모듈이 num_times·last_mentioned_at을 입력으로 받을 수 있음. |
| **기본 흐름** | 1) recall 시 각 후보 항목의 num_times, last_mentioned_at을 읽는다. 2) 최종 점수에 boost(예: 1 + log(1 + num_times) * recency_factor(last_mentioned_at))를 적용한다. 3) 정렬 후 상위 K건을 반환한다. |
| **결과** | 동일 쿼리에서 반복된 기억이 더 높은 순위로 노출될 수 있음. |

### UC-4: 병합된 원본 추적(선택)

| 항목 | 내용 |
|------|------|
| **액터** | 운영자, 디버깅 도구 |
| **전제 조건** | REQ-MERGE-3 구현 시: soft-delete 또는 merged_into_id 등 참조 저장. |
| **기본 흐름** | 1) 대표 ID로 “이 항목에 병합된 원본 ID 목록”을 조회한다. 2) (선택) 원본 항목 메타만 조회(soft-delete 시 deleted_at, merged_into_id 등). |
| **결과** | 감사·이력 분석 가능. |

---

## 4. 제약 사항

| ID | 제약 | 검증 방법 |
|----|------|-----------|
| CON-1 | **#88 의존**: num_times, last_mentioned_at은 #88 Fact 메타데이터 스키마가 반영된 후에만 사용한다. | #88 마이그레이션·타입 존재 시에만 병합·랭킹 로직 활성화. |
| CON-2 | 병합 정책은 **기존 remember/recall 동작과 호환**되어야 한다. 즉시 기록(remember)은 그대로 유지되고, 병합은 백그라운드에서만 수행된다. | remember 호출 시 즉시 1건 저장; 워커가 별도로 병합. |
| CON-3 | **저장 효율과 기억 효율 균형**: 병합으로 행 수를 줄이되, 반복 정보는 메타데이터로 보존한다. “단순 삭제만” 하는 정책은 본 명세 범위 밖이다. | REQ-MERGE-1, REQ-MERGE-2 충족. |

---

## 5. 수용 기준 (Acceptance Criteria)

다음이 모두 만족되면 SPECIFY 대비 구현이 완료된 것으로 판단한다.

- [ ] **AC1** 유사 기억을 병합한 뒤, 대표 항목의 **num_times**가 병합 건수를 반영하여 갱신되어 있다.
- [ ] **AC2** 유사 기억을 병합한 뒤, 대표 항목의 **last_mentioned_at**이 병합 집합 중 최신 시각으로 갱신되어 있다.
- [ ] **AC3** recall(또는 동일 검색 엔진) 결과에서, **num_times가 더 큰 항목**이 동일 쿼리·동일 유사도 구간에서 더 높은 순위에 노출될 수 있다(또는 boost가 적용됨).
- [ ] **AC4** #89 또는 #90 파이프라인/워커 문서·코드에 “병합 시 num_times·last_mentioned_at 갱신”이 명시되어 있다.
- [ ] **AC5** (선택) 병합된 원본 ID를 soft-delete 또는 merged_into_id로 조회할 수 있다.

---

## 6. 참조

- **요구사항(사용자 여정·목표)**: [requirements.md](./requirements.md)
- **설계**: [design.md](./design.md)
- **메모리 뱅크**: [structure.md](./structure.md), [tech.md](./tech.md), [product.md](./product.md)
- **작업 분해**: [tasks.md](./tasks.md)
- **구현 계획**: [implementation-plan.md](./implementation-plan.md)
- **논의 요약**: [2026-03-14-issue-20-memory-vs-storage-discussion.md](../2026-03-14-issue-20-memory-vs-storage-discussion.md)

---

*이 명세는 SDD의 Plan → Task → Implement 단계에서 기준 문서로 사용한다.*

**다음 단계**: [design.md](./design.md) (Plan) → [tasks.md](./tasks.md) → [implementation-plan.md](./implementation-plan.md)
