# 설계: 이슈 #243 — 리뷰 후보 Admin HTTP API 및 배치 연동 (`memento-server` + `BatchScheduler`)

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-02  
**이슈**: [GitHub #243](https://github.com/jee1/memento/issues/243)  
**상위**: [#18](https://github.com/jee1/memento/issues/18)  
**선행**: [#240](https://github.com/jee1/memento/issues/240), [#241](https://github.com/jee1/memento/issues/241), [#242](https://github.com/jee1/memento/issues/242) — 코어 스키마·선정·persist API는 `main` 기준으로 반영됨을 가정한다.

---

## 1. 배경·목표

에이전트/운영자가 **리뷰 큐**를 HTTP admin으로 조회하고 `review` / `dismiss`를 처리할 수 있게 한다. 후보 행은 배치가 주기적으로 `#241 select` + `#242 upsert`로 갱신한다.

**비목표**

- 대시보드 정적 UI(별도 이슈).
- MCP 도구 노출.
- `memory_item` 본문을 **목록** 응답에 포함하지 않는다(아래 §3 확정).

---

## 2. 구현 접근 비교 (2~3안)

| 접근 | 요약 | 장점 | 단점 |
|------|------|------|------|
| **A. `admin.routes.ts`에 라우트 직접 추가** | `GET/POST`를 기존 파일에 이어 붙인다. | 패턴 일치(consolidation, batch 등), diff 한 파일에 모여 리뷰 용이. | 파일이 비대해질 수 있음(후속 분리 가능). |
| **B. `admin/admin-memory-review.routes.ts` 분리** | `createAdminRouter`에서 `router.use`로 등록. | 관심사 분리, 테스트 파일도 분리하기 쉬움. | 신규 파일·와이어링 증가. |
| **C. 배치 로직을 별도 Job 클래스로 추출** | `MemoryReviewCandidatesBatchJob` 등. | 단위 테스트·의존성 주입에 유리. | #243 규모 대비 보일러플레이트. |

**선택**

- **라우팅: A** — 이슈 범위·기존 `admin.routes` 패턴에 맞춘다. 파일이 700줄을 넘기면 후속 리팩터로 B를 검토한다.
- **배치: `BatchScheduler` private 메서드 + `scheduleJob`** — 기존 `runMemoryCleanup` 등과 동일한 `BatchJobResult` 계약을 따른다(C안은 보류).

---

## 3. HTTP API 계약

모든 경로는 기존과 같이 **`/admin` 마운트 + 브라우저 세션**(`http-server.ts`의 `browserSessionAuth`) 하에서만 동작한다. 별도 API 키 미들웨어를 두지 않는다.

### 3.1 `GET /admin/memory/review-candidates`

**쿼리**

- `status` (선택): `pending` \| `reviewed` \| `dismissed` \| `expired`. 생략 시 **전체** 상태(코어 `listMemoryReviewCandidates` 기본 동작과 정합).

**응답 200**

- 본문: `{ "candidates": CandidateDto[], "timestamp": string }` 형태(필드명은 구현 시 기존 admin JSON 관례에 맞춤).
- **`CandidateDto`**: `MemoryReviewCandidateRow`를 JSON으로 직렬화한 것과 동등 **단, `memory_item.content` 등 본문 필드는 포함하지 않는다.**  
  즉 큐 테이블 컬럼(`id`, `memory_id`, `status`, `priority`, `reason`, `due_at`, 타임스탬프들, `metadata_json`)만 노출한다.  
  메모리 본문이 필요하면 기존 admin의 메모리/그래프 등 **별도 엔드포인트**로 `memory_id`를 넘겨 조회한다.

**에러**

- DB 미연결 등 서버 오류: **500** (기존 admin 라우트와 동일).
- 잘못된 `status` 값: **400** + `{ "error": "..." }`.

**로깅**

- 성공/실패 로그에 **memory 본문(`memory_item.content`)을 남기지 않는다** (이슈 완료 조건).  
  권장: `candidate_id`·`memory_id`·건수·HTTP 상태 중심. `reason` 문자열은 본문이 아니나 길이가 길 수 있으므로 로그에는 **길이 상한이 있는 요약**만 남기거나 생략한다.

### 3.2 `POST /admin/memory/review-candidates/:id/review`

- **본문**: `{}` 허용(추가 필드 없음).
- **동작**: `markMemoryReviewCandidateReviewed(db, id, nowIso)` 호출. `nowIso`는 `new Date().toISOString()` (서버 UTC).
- **응답**: 200 + 갱신된 후보 DTO 또는 `{ "ok": true, ... }` — 구현 시 기존 admin 성공 응답 스타일에 맞춰 한 가지로 통일.

### 3.3 `POST /admin/memory/review-candidates/:id/dismiss`

- **본문**: `{}` 허용.
- **동작**: `markMemoryReviewCandidateDismissed(db, id, nowIso)`.

### 3.4 도메인 오류 → HTTP (`MemoryReviewCandidateError`)

| 조건 | HTTP | 응답 바디 |
|------|------|-----------|
| 존재하지 않는 `:id` | **404** | `{ "error", "code": "memory_review_candidate_not_found" }` |
| `pending`이 아님(review/dismiss) | **409** | `{ "error", "code": "memory_review_candidate_not_actionable" }` |
| `:id`가 UUID 형식이 아님 등 **명백한 클라이언트 오류** | **400** | 검증 메시지 |

구현은 `instanceof MemoryReviewCandidateError`이면 `err.statusCode`를 그대로 사용한다(#242 설계와 정합).

---

## 4. 배치 스케줄러

### 4.1 작업 이름·주기

- **스케줄 키(인터벌 맵 / `getStatus().activeJobs`에 나타나는 이름)**: `memory_review_candidates` (이슈 본문과 동일 문자열).
- **주기**: 신규 `BatchJobConfig` 필드 + 환경변수로 설정 가능하게 한다.  
  예: `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS`, 기본값 **24h** (`86_400_000`). 최솟값은 `resolveValidatedNumber` 관례에 맞춰 **≥ 60_000** 으로 검증한다.

### 4.2 실행 본문 (`runMemoryReviewCandidates` 등)

1. `this.db` 열림 여부 확인(`runMemoryCleanup`과 동일 패턴).
2. `selectMemoryReviewCandidates(this.db)` 호출(옵션은 env `#241`과 동일 파서 재사용).
3. 각 `MemoryReviewCandidateSelectionItem`을 `UpsertPendingMemoryReviewCandidateInput`으로 매핑:
   - `memory_id`, `priority`, `reason` — 그대로.
   - **`due_at`**: 선정 결과에 필드가 없으므로 배치 시각 기준으로 계산한다.  
     **확정 규칙**: 환경변수 `MEMORY_REVIEW_CANDIDATE_DUE_DAYS`(정수, 기본 **14**)만큼 `Date.now()`에 일 단위 오프셋을 더한 시각을 ISO 문자열로 저장한다.
   - **`metadata_json`**: `JSON.stringify({ score_breakdown })` (본문 없음 — 큐 메타만).
4. `upsertPendingMemoryReviewCandidates(db, inputs, nowIso)` 호출.
5. `BatchJobResult`: `jobType: 'memory_review_candidates'`, `processed` = upsert 입력 길이, `details` = `{ inserted, updated }` (#242 반환 타입).

### 4.3 `BatchScheduler.start`

- `this.scheduleJob('memory_review_candidates', interval, () => { … }, priority)` 로 등록.  
  **priority**는 기존 `scheduleJob` 호출에서 사용 중인 숫자와 겹치지 않게 배정한다.

### 4.4 `runJob` (수동 실행)

- `runJob`의 `jobType` 유니온에 **`memory_review_candidates`** 를 추가하고, `switch`에서 배치 본문을 호출한다.
- `lastExecution` / `totalExecutions` 맵 키는 스케줄 이름과 동일하게 `memory_review_candidates`를 사용한다.

---

## 5. `POST /admin/batch/run` 허용 목록

현재 라우터는 `cleanup` \| `monitoring` 만 허용하나, `runJob`은 `healthcheck` \| `meta_memory_introspection` 도 지원한다.

**#243 범위(필수)**

- 허용 배열에 **`memory_review_candidates`** 를 추가한다.

**비목표(명시적)**

- 동일 PR에서 `healthcheck`·`meta_memory_introspection` 을 `/admin/batch/run`에 노출할지는 제품 정책에 따른 별 결정으로 둔다.

**요청 바디**

- `{ "jobType": "memory_review_candidates" }` → `runJob` 위임 → 200 + `result`.

---

## 6. 테스트 계획

### 6.1 `packages/memento-server`

- **`admin.routes.spec.ts` 확장**(또는 동일 패턴 신규 파일): 기존 헬퍼로
  - `GET .../review-candidates` 200, 응답에 `memory_item` 본문 필드가 **없음**을 assert.
  - 잘못된 `status` → 400.
  - `POST .../review` / `dismiss` — 픽스처 후보 `pending`에서 200, 재호출 시 **409**.
  - 존재하지 않는 UUID → 404.

### 6.2 `packages/memento-core`

- **`batch-scheduler.spec.ts`** (또는 소형 통합 spec): `runJob('memory_review_candidates')` 또는 스케줄 등록 후 `getStatus().activeJobs`에 키가 포함되는지 검증. 테스트 DB에는 최소 `memory_item` + 033 스키마가 있어야 `select`가 의미 있게 동작한다.

---

## 7. 완료 조건 (이슈 본문과 매핑)

| 이슈 조건 | 설계 대응 |
|-----------|-----------|
| 기존 admin 인증 유지 | §3 세션 미변경 |
| 200/400/404/409 일관 | §3.4 표 + 잘못된 쿼리 400 |
| 배치가 후보 생성·스케줄러 상태 노출 | §4 |
| 로그에 memory content 미기록 | §3.1 로깅 + 응답에 본문 미포함 |

---

## 8. 출처

- [GitHub #243](https://github.com/jee1/memento/issues/243)
- [#242 설계](./2026-05-02-issue-242-memory-review-candidate-persistence-design.md)
- [#241 설계](./2026-05-02-issue-241-memory-review-candidate-selection-design.md)
- [#240 설계](./2026-05-02-issue-240-memory-review-candidate-design.md)

---

## 9. Spec self-review (체크리스트)

- **Placeholder**: 없음.
- **내부 정합**: `due_at`은 §4.2 단일 규칙으로 고정.
- **범위**: 서버 라우트 + 스케줄러 + 테스트만; UI·MCP 제외.
- **모호성 해소**: 목록 응답은 **큐 테이블 메타만**; 본문은 다른 admin API.
