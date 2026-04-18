# 이슈 #81: 프로젝트 스코프 기억 시스템 설계

**날짜**: 2026-04-18  
**이슈**: [#81 개발자용 AI 기억 백엔드 MVP - 프로젝트 컨텍스트 기억 시스템](https://github.com/jee1/memento/issues/81)  
**상태**: 설계 완료, 구현 대기

---

## 1. 목표

AI 에이전트가 프로젝트별로 맥락(아키텍처 결정, 코딩 컨벤션, 구현 이유)을 기억하고, 대화 세션이 끊겨도 해당 맥락을 복원할 수 있도록 한다.

**핵심 가치**: "IDE를 닫아도, 대화를 끊어도 프로젝트의 기억은 유지된다."

---

## 2. 범위 결정 요약

| 항목 | 결정 | 이유 |
|------|------|------|
| 구현 방식 | 기존 도구 확장 (새 MCP 도구 추가 없음) | MCP 도구 수 증가 = 컨텍스트 창 부담 |
| 프로젝트 식별 | 명시적 `project_id` 파라미터 | 서버가 클라이언트 경로를 알 수 없음 |
| DB 저장 | `memory_item.project_id` 컬럼 추가 | `process_id`/`session_id`와 동일 패턴, 효율적 인덱싱 |
| 오래된 기억 정리 | HTTP Admin 엔드포인트 | MCP에 노출 불필요, 운영자/자동화 용도 |

---

## 3. 아키텍처

### 3.1 DB 스키마 변경

**파일**: `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.ts`

> 주의: 031까지 사용 중 (`031-soft-delete-fields.ts`). 다음 번호는 **032**.

```sql
ALTER TABLE memory_item ADD COLUMN project_id TEXT;
CREATE INDEX idx_memory_item_project_id_type
  ON memory_item(project_id, type)
  WHERE project_id IS NOT NULL;
```

- `project_id TEXT NULL` — 기존 기억은 NULL, 하위 호환 유지
- `(project_id, type)` 복합 partial index — Admin cleanup API의 `WHERE project_id = ? AND type IN (...)` 쿼리 커버

### 3.2 MCP 도구 변경

#### `remember` 도구
**파일**: `packages/memento-core/src/domains/memory/tools/remember-tool.ts`

추가 파라미터:
```typescript
project_id: z.string().max(200).optional()
  .describe('프로젝트 식별자. 동일 project_id로 저장한 기억끼리 recall/memory_injection 시 필터링 가능')
```

동작:
- `project_id`를 `memory_item.project_id` 컬럼에 저장
- 미지정 시 NULL (기존 동작 유지)

#### `recall` 도구
**파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`

추가 파라미터:
```typescript
project_id: z.string().max(200).optional()
  .describe('이 project_id로 저장된 기억만 검색. 미지정 시 전체 검색')
```

**필터링 방식**: 기존 `owner_id`/`process_id`/`session_id`와 동일하게 **인메모리 후처리** 방식 사용.
- FTS5 + 벡터 검색으로 후보를 먼저 가져온 뒤
- `results.filter(item => item.project_id === project_id)` 형태로 적용
- FTS5 가상 테이블에 `project_id` 컬럼을 추가하거나 트리거를 수정하지 않음

> 근거: `owner_id`/`process_id`/`session_id` 필터가 이미 동일 방식(in-memory, recall-tool.ts:1020~1037)으로 구현되어 있으며, 일관성 유지가 중요.

**⚠️ Precision Loss Trade-off (MVP 허용, 추후 최적화)**  
`project_id`는 핵심 격리 단위이므로, 전체 기억 중 해당 프로젝트 비율이 낮으면 인메모리 필터 후 유효 결과가 `limit`보다 훨씬 적게 반환될 수 있다 (극단적으로 0건). MVP에서는 이 trade-off를 허용하고 일관성을 우선한다. 추후 사용량이 늘면 `HybridSearchService`에 `projectId`를 SQL-level 파라미터로 전달하는 방식으로 최적화한다.

**타입 주의**: `recall-tool.ts` 내부에 `RecallSearchItem` 등 로컬 타입이 있다면 `project_id?: string` 필드를 해당 타입에도 추가해야 한다. `shared/types/index.ts`의 `MemoryItem` 수정만으로 커버되지 않을 수 있다.

#### `memory_injection` 도구 (핵심)
**파일**: `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts`

추가 파라미터:
```typescript
project_id: z.string().max(200).optional()
  .describe('지정 시 해당 프로젝트 기억만 주입. 미지정 시 기존 동작 유지')
```

동작:
- `project_id` 지정 시 해당 프로젝트 기억만 컨텍스트에 주입
- 세션 시작 시 에이전트의 진입점으로 동작

**에이전트 워크플로우**:
```
세션 시작 → memory_injection(project_id: "my-project")
              → 프로젝트 맥락 자동 주입
결정 발생  → remember(content: "...", project_id: "my-project", type: "semantic")
맥락 필요  → recall(query: "...", project_id: "my-project")
```

`forget` 도구는 이번 이슈 범위에서 제외. 프로젝트 기억 삭제는 `recall`로 ID를 찾은 뒤 기존 `forget`으로 처리 가능.

### 3.3 HTTP Admin API

**파일**: `packages/memento-server/src/server/http-server.ts` (또는 라우터 파일)

#### `GET /admin/memory/project/:project_id/stats`

프로젝트별 기억 통계 조회.

```json
{
  "project_id": "my-project",
  "total": 42,
  "by_type": { "semantic": 15, "episodic": 20, "procedural": 7 },
  "oldest_created_at": "2025-01-15T00:00:00Z",
  "newest_created_at": "2026-04-10T00:00:00Z"
}
```

#### `GET /admin/memory/project/:project_id/cleanup/preview`

삭제 대상 목록만 조회 (실제 삭제 없음).

쿼리 파라미터:
- `older_than_days` (필수, integer) — 며칠 이전 기억을 대상으로 볼지
- `types` (선택, 콤마 구분) — 대상 타입 (기본값: `episodic,working`. **`core` 전달 시 400 오류**)

응답:
```json
{
  "would_delete": 8,
  "items": [
    { "id": "mem_xxx", "content": "...", "type": "episodic", "created_at": "..." }
  ]
}
```

#### `DELETE /admin/memory/project/:project_id/cleanup`

오래된 프로젝트 기억 실제 삭제.

쿼리 파라미터: `GET /cleanup/preview`와 동일.

유효성 검증:
- `older_than_days` 미지정 → 400
- `types`에 `core` 포함 → 400 (`core` 타입은 항상 보호)
- `types`에 허용되지 않는 값 → 400

응답:
```json
{
  "deleted": 8
}
```

> **dry_run 대신 엔드포인트 분리**: `dry_run=true`인 DELETE 메서드는 HTTP 표준 위반(멱등성 위반). `GET /preview` + `DELETE /cleanup`으로 의도를 명확히 분리.

---

## 4. 데이터 흐름

```
에이전트
  │
  ├─ remember(project_id) ──────→ memory_item.project_id 저장
  │
  ├─ recall(project_id) ────────→ FTS5 + 벡터 검색 후
  │                                인메모리 project_id 필터 적용
  │
  ├─ memory_injection(project_id) → 프로젝트 기억만 컨텍스트 주입
  │
  └─ (HTTP) /admin/cleanup ─────→ older_than_days 기준 soft/hard delete
                                   (core 타입 제외, 복합 인덱스 활용)
```

---

## 5. 테스트 전략

### 단위 테스트 (`.spec.ts`, 소스 파일 옆)
- `remember-tool.spec.ts`: `project_id` 저장 및 DB 컬럼 반영 검증
- `recall-tool.spec.ts`: `project_id` 인메모리 필터 — 다른 프로젝트 기억이 결과에 섞이지 않음
- `memory-injection-prompt.spec.ts`: `project_id` 지정 시 해당 프로젝트 기억만 주입

### 통합 시나리오
```
시나리오: 프로젝트 A/B 기억 격리
1. remember("결정A", project_id: "proj-a")
2. remember("결정B", project_id: "proj-b")
3. recall(query: "결정", project_id: "proj-a") → 결정A만, 결정B 없음
4. memory_injection(project_id: "proj-a") → 결정A만 주입

시나리오: project_id 미지정 시 기존 동작 유지
1. remember("기존 기억") — project_id 없음
2. recall(query: "기존") — project_id 없음 → 기존 기억 포함
```

### HTTP Admin 테스트
- `GET /preview` → 삭제 없이 대상 목록 반환
- `DELETE /cleanup` → 실제 삭제 후 카운트 반환
- `core` 타입 포함 요청 → 400 오류
- `older_than_days` 미지정 → 400 오류
- cleanup 대상이 0건일 때 정상 응답

### 마이그레이션 회귀
- 032 마이그레이션 실행 후 기존 기억의 `project_id = NULL`
- NULL인 기억이 `project_id` 필터 없는 recall에 정상 포함됨

---

## 6. 변경 파일 목록

| 파일 | 변경 유형 |
|------|----------|
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.ts` | 신규 |
| `packages/memento-core/src/infrastructure/database/database/migration/migrations/032-add-project-id.spec.ts` | 신규 |
| `packages/memento-core/src/shared/types/index.ts` | 수정 (`MemoryItem`에 `project_id?: string` 추가) |
| `packages/memento-core/src/domains/memory/tools/remember-tool.ts` | 수정 |
| `packages/memento-core/src/domains/memory/tools/recall-tool.ts` | 수정 |
| `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts` | 수정 |
| `packages/memento-server/src/server/http-server.ts` (또는 라우터) | 수정 |
| 각 도구별 `.spec.ts` | 수정/신규 |

---

## 7. 비기능 요구사항

- **하위 호환**: `project_id` 미지정 시 기존 동작 완전 동일
- **성능**: `(project_id, type)` 복합 partial index로 cleanup 쿼리 O(log n)
- **보안**: `project_id` 최대 200자 제한, SQL injection 방지 (파라미터 바인딩), `core` 타입 항상 보호
- **일관성**: 필터링은 기존 attribution 필드(`owner_id`, `process_id`, `session_id`)와 동일하게 인메모리 후처리 방식
