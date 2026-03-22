# Issue #57 Phase 2 — D) 다중 에이전트 설계

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) — Procedural Memory Phase 2  
**로드맵**: [roadmap.md](./roadmap.md) (4단계 D)

---

## 1. 목표·범위

**목표**: 이슈 #57의 "다중 에이전트: privacy_scope/ownership 확장안 조사·설계 → 필요 시 구현"을 충족.

**범위**
- **조사**: 기존 `core_memory`, `knowledge_vault`의 `agent_id` 사용 방식, 앵커 슬롯(agent_id) 구조와의 일관성 검토.
- **설계**: `memory_item`에 소유자(owner) 식별자 필드 추가, recall 시 소유자/권한 필터, remember/remember_procedure 저장 시 소유자 설정.
- **구현**: 스키마 마이그레이션, 툴 스키마·필터 로직, 단일 에이전트 하위 호환(기본값) 유지.

**제외**: 실제 인증·세션별 agent_id 주입 경로(HTTP 헤더, MCP 메타데이터 등)는 인프라 레벨에서 별도 다룸. 본 단계에서는 "컨텍스트에서 agent_id를 받을 수 있는 훅"만 확보하고 기본값 `default`로 동작.

---

## 2. 현재 상태 조사

### 2.1 core_memory / knowledge_vault

- **core_memory**: `agent_id TEXT NOT NULL DEFAULT 'default'`, `UNIQUE(agent_id, key)`, `idx_core_memory_agent_id`.
- **knowledge_vault**: `agent_id TEXT NOT NULL DEFAULT 'default'`, `UNIQUE(agent_id, key, version)`, `idx_knowledge_vault_agent_id`, `idx_knowledge_vault_agent_key`.
- 조회/저장 시 `agent_id`로 스코프. 단일 에이전트 환경에서는 `'default'` 사용.

### 2.2 memory_item

- **agent_id/owner 없음**. `privacy_scope`만 있음 (`private` | `team` | `public`).
- recall에서 `privacy_scope` 필터 지원. 소유자별 격리는 없음.

### 2.3 앵커

- 앵커 슬롯 구조에 `agent_id` 사용(3-slot A/B/C per agent). 앵커 맵은 agent별로 분리 가능.

### 2.4 결론

- `memory_item`에 **owner_id**(또는 `agent_id`) 필드를 추가하면 core_memory, knowledge_vault와 네이밍·의미를 맞출 수 있음. 이슈에서 "ownership"이라고 했으므로 **owner_id**로 명명하고, 값의 의미는 "에이전트/소유자 식별자"로 통일.

---

## 3. 스키마 설계

### 3.1 memory_item 확장

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| owner_id | TEXT | NULL | 소유자(에이전트) 식별자. NULL = 단일 에이전트(기존 동작), 값 있으면 해당 소유자 메모리. |

- **NULL 허용**: 기존 행은 NULL 유지. 새로 저장 시 컨텍스트에서 받은 값 또는 `'default'`로 설정 가능.
- **인덱스**: `idx_memory_item_owner_id ON memory_item(owner_id)` (recall 필터·조인 가속). partial index는 사용하지 않음(다른 type도 동일 필드 사용).

### 3.2 privacy_scope와의 관계

- **privacy_scope**: 접근 권한 수준(private / team / public). 기존 의미 유지.
- **owner_id**: "누가 소유하는가". recall 시 "내 소유만" 필터는 `owner_id = ?`로 수행.
- **조합**: "내 소유이면서 team 이상 공개" 같은 조건은 `owner_id = ? AND privacy_scope IN ('team','public')` 등으로 표현. 1차 구현에서는 recall에 `owner_id` 필터만 추가하고, team/public 해석(다른 에이전트가 team 메모리 조회 가능 등)은 옵션으로 둠.

---

## 4. 툴·API 동작

### 4.1 remember / remember_procedure

- **저장 시**: `owner_id`를 파라미터로 받거나, context에서 `context.agentId`(또는 `context.ownerId`)를 읽어서 설정. 없으면 NULL 또는 `'default'`.
- **스키마**: remember 스키마에 `owner_id: z.string().optional()`, remember_procedure에도 동일. 클라이언트가 명시하지 않으면 서버 기본값.

### 4.2 recall

- **필터**: `owner_id?: string | string[]`. 단일 값이면 해당 소유자만, 배열이면 IN 조건. 미지정 시 기존 동작(전체 조회, privacy_scope 필터만 적용).
- **정의**: "내 에이전트 메모리만 보고 싶다" → `owner_id: context.agentId` 또는 클라이언트가 `owner_id` 전달.

### 4.3 forget / pin / unpin

- 소유자 검사: "다른 에이전트 메모리는 삭제/수정 불가" 정책을 넣을 경우, handle 내부에서 `owner_id === context.agentId` 확인 후 불일치 시 403 스타일 에러. 1차 구현에서는 선택 사항.

### 4.4 procedural_diff / procedural_rollback

- 동일 version_series 내 버전은 동일 소유자로 가정. rollback 결과도 동일 owner_id 유지.

---

## 5. 컨텍스트·기본값

- **ToolContext**: `ToolContext` 타입에 `agentId?: string` (또는 `ownerId?: string`) 필드 추가. HTTP 서버나 MCP 레이어에서 세션/헤더 기반으로 채워 넣을 수 있도록.
- **기본값**: agentId 미제공 시 `owner_id = NULL` 또는 `'default'`. NULL이면 "소유자 필터 없음"으로 해석하고, recall은 기존처럼 모든 메모리 대상(privacy_scope만 적용). 새로 저장할 때만 `owner_id = 'default'`로 두면 단일 에이전트와 동일 동작.

---

## 6. 마이그레이션

- **파일**: `015-memory-item-owner-id.ts` (또는 014 다음 번호. B에서 014 사용 시 015).
- **up**: `ALTER TABLE memory_item ADD COLUMN owner_id TEXT NULL;`, `CREATE INDEX IF NOT EXISTS idx_memory_item_owner_id ON memory_item(owner_id);`
- **down**: 인덱스 삭제, 컬럼 삭제(SQLite 3.35.0+ 에서 DROP COLUMN, 아니면 테이블 재생성 등 기존 프로젝트 규칙 따름).
- **백필**: 기존 행은 `owner_id = NULL` 유지. 필요 시 "단일 에이전트 가정"으로 `UPDATE memory_item SET owner_id = 'default' WHERE owner_id IS NULL`을 별도 마이그레이션 또는 문서화된 수동 단계로 제안 가능.

---

## 7. 에러 처리·테스트·파일 배치

**에러 처리**: owner_id 필터 시 타입/값 검증. 잘못된 값은 400. 소유자 불일치로 수정 거부 시 403.

**테스트**
- 마이그레이션 015: owner_id 컬럼·인덱스 생성/삭제 검증.
- remember/remember_procedure: owner_id 저장 검증(파라미터 또는 context).
- recall: owner_id 필터 적용 시 해당 행만 반환하는지 검증.
- 기존 호출(owner_id 미지정): 동작 회귀 없음 검증.

**파일 배치**
- 마이그레이션: `src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.ts`, `.sql`, `.spec.ts`
- 스키마: `schema.sql`에 owner_id·인덱스 반영
- 타입: `ToolContext`에 `agentId?: string` 추가 (`src/tools/types.ts` 등)
- remember-tool, remember-procedure-tool, recall-tool: owner_id 파라미터·저장·필터 로직
- 공유 타입: `MemoryItem` 등에 `owner_id?: string | null` 추가

---

## 8. 우선순위 요약

1. **필수**: 스키마 owner_id 추가(015) + remember/remember_procedure 저장 시 owner_id 설정 + recall owner_id 필터.
2. **선택**: forget/pin/unpin 소유자 검사, context.agentId 채우는 인프라(HTTP/MCP).
3. **문서**: 다중 에이전트 사용 가이드(owner_id 의미, 기본값, 컨텍스트 설정 방법) 짧은 절.

이 순서로 구현 계획에 반영한다.
