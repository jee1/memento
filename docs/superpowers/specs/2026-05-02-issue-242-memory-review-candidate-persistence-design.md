# 설계: 이슈 #242 — 리뷰 후보 저장소와 review/dismiss 상태 전이 (`@memento/core`)

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-02  
**이슈**: [GitHub #242](https://github.com/jee1/memento/issues/242)  
**범위 결정**: **Core만** — `packages/memento-server` Admin HTTP·409 응답 매핑은 별도 이슈. 본 문서는 persistence·도메인 오류 계약·Vitest까지 고정한다.

**선행 정합**

- 스키마·인덱스: [이슈 #240 설계](./2026-05-02-issue-240-memory-review-candidate-design.md), 마이그레이션 `033-memory-review-candidate-schema`.
- 후보 산출(읽기 전용): [이슈 #241 설계](./2026-05-02-issue-241-memory-review-candidate-selection-design.md), `selectMemoryReviewCandidates`.

---

## 1. 배경·문제

#241까지는 후보를 **고르기만** 하고 DB에 쓰지 않는다. 자동 리뷰 MVP를 진행하려면 선정된 후보를 **안전하게 저장**하고, 사용자(또는 이후 배치)의 **review / dismiss / expire** 액션을 **명시적 상태 전이**로 반영해야 한다. 동일 배치·동일 `memory_id`에 대한 **중복 실행은 멱등**해야 하며, 이미 종료된 후보에 대한 잘못된 액션은 **HTTP 409에 매핑할 수 있는 도메인 계약**으로 표현한다.

---

## 2. 구현 접근 비교 (2~3안)

| 접근 | 요약 | 장점 | 단점 |
|------|------|------|------|
| **A. 도메인 서비스 + 얇은 SQLite 헬퍼** | `memory-review-candidate-persistence-service.ts`가 전이 규칙·타임스탬프·`memory_item` 갱신을 소유하고, SQL은 같은 모듈 또는 `*-sqlite.helpers.ts`에 둔다. | #241 `selectMemoryReviewCandidates`와 동일 계층(`domains/memory/services/`)이라 탐색·테스트 일관성이 좋다. | 파일이 커지면 후속 분리 필요. |
| **B. 인터페이스 repository + `infrastructure` 구현** | `IMemoryReviewCandidateRepository` + `*-sqlite.impl.ts` 패턴. | 경계가 명확해 교체 테스트에 유리하다. | 보일러플레이트 증가, 현재 후보 기능 규모 대비 과할 수 있다. |
| **C. SQL 전부 meta-memory-service류에 통합** | 기존 대형 서비스에 메서드 추가. | 파일 수 최소. | 책임 혼잡, diff 리뷰·충돌 비용 큼. |

**선택: A (추천)** — 이슈가 요구하는 단위가 "repository **또는** service persistence"이고, #241과 나란히 두는 것이 PR 단위·인지 부하에 유리하다. 이후 HTTP·배치가 붙으면 필요 시 B로 추출한다.

---

## 3. 목표·비목표

### 3.1 목표 (#242)

- **Upsert(멱등)**: 동일 `memory_id`에 대해 `pending` 후보를 다시 넣는 연산을 **중복 행 없이** 수렴시킨다 (DB partial unique와 애플리케이션 로직 정합).
- **조회**: 후보 단건 `get`·목록 `list` (필터: `status`, 정렬은 #240 큐 인덱스 `(status, priority DESC, due_at ASC)`와 맞춘다).
- **전이**: `pending → reviewed`, `pending → dismissed`, `pending → expired`만 허용. `updated_at`은 전이 시 갱신. `reviewed_at` / `dismissed_at`은 각각 해당 전이에서 설정.
- **도메인 오류**: 이미 `pending`이 아닌 후보에 review/dismiss 시, 호출자가 HTTP 409로 매핑할 수 있는 **안정적인 `code` + `AppErrorContract`**(또는 동등 필드를 가진 에러 클래스)를 던진다.
- **review 시 `memory_item`**: `last_accessed`, `last_accessed_at` 갱신(기존 `pin-tool` 등과 동일한 SQL 관례).
- **테스트**: (1) 동일 배치 입력 두 번 — `pending` 행 수 불변(또는 동일 `memory_id`당 1행 유지), (2) review/dismiss 후 재액션 시 도메인 오류, (3) dismiss가 `memory_item` 본문·중요도 필드를 변경하지 않음을 assert.

### 3.2 비목표 (#242)

- `packages/memento-server` 라우트, 실제 HTTP 409 응답, MCP 도구, `BatchScheduler` Job 등록.
- 후보 **산출 알고리즘** 변경(#241 범위).
- 스키마·마이그레이션 번호 변경.

---

## 4. 아키텍처·공개 API

- **위치**: `packages/memento-core/src/domains/memory/services/`
  - 예: `memory-review-candidate-persistence.types.ts` (행 DTO, 입력 타입, 상태 리터럴 타입)
  - 예: `memory-review-candidate-persistence-service.ts` (공개 함수들)
  - 예: `memory-review-candidate-persistence-service.spec.ts`
- **`Database` 타입**: 기존과 같이 `better-sqlite3` 동기 API. 서비스 함수는 `(db: Database, …) => …` 형태를 #241과 맞춘다.
- **스키마 보장**: 공개 진입점에서 `ensureMemoryReviewCandidateSchema(db)` 호출.

**제안 공개 함수 (이름은 구현 시 일관되게 조정 가능)**

- `upsertPendingMemoryReviewCandidates(db, items: UpsertPendingInput[], now: IsoString): UpsertPendingResult`  
  - **멱등**: 동일 `memory_id`로 이미 `pending`이 있으면 **새 행을 만들지 않고** `priority`, `reason`, `due_at`, `metadata_json`, `updated_at`만 갱신한다(배치 재실행 시 스냅샷 최신화 + 완료 조건 "중복 pending 없음" 동시 만족).
- `listMemoryReviewCandidates(db, query: ListQuery): Row[]`
- `getMemoryReviewCandidateById(db, id: string): Row | null`
- `markMemoryReviewCandidateReviewed(db, candidateId: string, now: IsoString): void`
- `markMemoryReviewCandidateDismissed(db, candidateId: string, now: IsoString): void`
- `markMemoryReviewCandidateExpired(db, candidateId: string, now: IsoString): void`

`markMemoryReviewCandidateReviewed`는 `UPDATE memory_review_candidate … WHERE id = ? AND status = 'pending'` 후 `changes` 검사 → 성공 시 동일 트랜잭션에서 `memory_item`의 `last_accessed`, `last_accessed_at` 갱신.

---

## 5. 오류 모델 (409 매핑용)

- **도메인 전용 에러** 추가: 예 `MemoryReviewCandidateStateError` — `AppErrorContract`와 호환되는 필드(`code`, `category`, `message`, `statusCode`)를 갖는다.

| 상황 | `code` (예시) | 제안 `statusCode` |
|------|----------------|-------------------|
| id 없음 | `memory_review_candidate_not_found` | 404 |
| `status !== 'pending'` 에 review/dismiss | `memory_review_candidate_not_actionable` | 409 |
| 잘못된 전이 | `memory_review_candidate_not_actionable` 또는 `invalid_transition` | 409 |

후속 HTTP 이슈에서는 `statusCode`를 그대로 응답에 사용하면 된다.

---

## 6. 데이터·동시성

- **트랜잭션**: review는 후보 행 + `memory_item` 접근 시각을 한 트랜잭션에서 처리.
- **Dismiss**: `memory_review_candidate`만 갱신. **`memory_item`의 본문·중요도 관련 컬럼은 UPDATE하지 않는다.**
- **Expire**: `memory_item` 비터치.

타임스탬프 문자열·`CURRENT_TIMESTAMP` 혼용은 `pin-tool`·`write-and-meta` 관례에 맞춘다.

---

## 7. 테스트 계획 (Vitest)

- **파일**: `memory-review-candidate-persistence-service.spec.ts`
- **픽스처**: 033 마이그레이션/ensure + 최소 `memory_item` 행 — #241 스펙과 동일 패턴 재사용.
- **케이스**: upsert 멱등, review 후 `last_accessed`/`last_accessed_at`, dismiss 후 memory 본문·중요도 불변, 이중 review/dismiss 시 409, expire.

---

## 8. 완료 조건 (이슈 본문과 정합)

- 중복 batch 실행이 `pending` 후보를 중복 생성하지 않는다.
- review 액션은 후보 상태와 memory 접근 시각만 갱신한다.
- dismiss 액션은 memory 본문과 중요도를 변경하지 않는다.
- `npm test` / `npm run type-check` 통과.
- **export**: 후속 서버 이슈를 위해 `packages/memento-core/src/index.ts`에서 공개 API export를 권장한다.

---

## 9. 출처

- [GitHub #242](https://github.com/jee1/memento/issues/242)
- [#240 설계](./2026-05-02-issue-240-memory-review-candidate-design.md)
- [#241 설계](./2026-05-02-issue-241-memory-review-candidate-selection-design.md)
