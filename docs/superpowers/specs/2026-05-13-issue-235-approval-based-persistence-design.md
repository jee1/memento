# 설계: 이슈 #235 — 승인 기반 persistence 경로 (두 단계)

**날짜**: 2026-05-13  
**이슈**: [#235](https://github.com/jee1/memento/issues/235)  
**부모**: [#82](https://github.com/jee1/memento/issues/82) 개인 지식 축적 Agent MVP  
**선행**: [#231](https://github.com/jee1/memento/issues/231) 계약, [#234](https://github.com/jee1/memento/issues/234) 후보 추출기  
**호출 모델 결정**: **B — 두 단계** (`runOneTurn`으로 후보·LLM, 별도 API로 승인된 후보만 `remember`).

---

## 1. 목표

1. **승인된 `KnowledgeCandidate`만** `remember` 저장으로 연결한다.  
2. 저장 **성공·실패를 후보별**로 구조화해 호스트가 Agent 루프 결과에 반영할 수 있게 한다.  
3. **자동 저장 경로가 없다** — `#234`와 동일하게 `runOneTurn`만으로는 DB에 후보 본문이 쓰이지 않는다.  
4. **미승인 후보는 절대 저장하지 않는다** — `approvedCandidateIds`에 없는 항목은 `remember`를 호출하지 않는다.

---

## 2. 범위

### 포함

- `KnowledgeCandidate`에 호스트가 승인 목록으로 되돌릴 수 있는 **`id: string` 필드** 추가.  
- `runOneTurn` 종료 시점마다 후보에 **고유 `id` 부여** (추출 직후, 동일 프로세스 내에서만 유효하면 됨).  
- 신규 공개 API: **`persistApprovedCandidates`** (이름 확정) — `candidates` 스냅샷 + `approvedCandidateIds` + `projectId` / `ownerId` / `sessionId` / `processId` 등 remember에 필요한 컨텍스트.  
- **순수 함수** `mapKnowledgeCandidateToRememberParams` (파일명은 구현 계획에서 확정) — 단위 테스트 대상.  
- `IPersistencePort`를 승인 기반 시그니처로 **교체**한다 (`persist(전체 배열)` 제거).  
- `RememberTool`(또는 동일 검증·저장 경로)과 `ToolContext`를 사용하는 **어댑터 구현체 1종** (예: `ToolContextRememberPersistenceAdapter`).  
- 단위 테스트: 매퍼, `persistApprovedCandidates` (목 persistence / 목 remember), 승인·거절 통합 시나리오.  
- `npm run type-check` 통과.

### 제외 (이슈 본문과 동일)

- 대화형 CLI UX 고도화  
- 후보 수정 UI  
- LLM 기반 후보 추출  
- **서버 측 턴 상태 저장** (`turnId`만으로 후보를 복원하는 세션 스토어) — 호스트가 **직전 `runOneTurn`이 반환한 `candidates` 배열을 그대로** 두 번째 호출에 실어 보낸다.

---

## 3. 두 단계 호출 모델 (채택안 B)

| 단계 | API | 하는 일 | 하지 않는 일 |
|------|-----|---------|--------------|
| **1** | `runOneTurn(input)` | 컨텍스트 빌드, 후보 추출·`id` 부여, LLM 완성, `proposeCandidates` | `remember` 호출 없음 |
| **2** | `persistApprovedCandidates(persistInput)` | `approvedCandidateIds ⊆ candidates[].id` 인 항목만 매핑 후 `remember` | LLM 호출 없음, `proposeCandidates` 재호출 없음(필요 시 후속 이슈) |

**이유 요약**: 승인 UX는 필연적으로 “후보 표시 → 선택”이므로 코어에서도 저장을 분리하는 것이 자연스럽고, LLM 중복 호출을 피하며, 미저장 불변식을 경계에서 테스트하기 쉽다.

---

## 4. 후보 `id` 규칙

- **형식**: `kc_` 접두사 + `randomUUID()` (Node `crypto.randomUUID`).  
- **부여 시점**: `extractKnowledgeCandidates` 반환 직후, 서비스 레이어에서 각 요소에 `id`를 채운 배열을 이후 단계 전체가 사용한다.  
- **추출기**: `#234` 범위 유지 — 추출기는 여전히 `id` 없이 순수하게 동작하거나, 동일한 매핑을 `assignKnowledgeCandidateIds(raw[])` 한 함수로 감싼다(구현 선택). 스펙상 **외부 계약에 노출되는 `KnowledgeCandidate`는 항상 `id`가 채워진 상태**로 `runOneTurn` / `persistApprovedCandidates`에 사용한다.  
- **재실행 시**: 동일 `userMessage`로 `runOneTurn`을 다시 호출하면 `id`는 달라질 수 있다. 호스트는 **한 번의 제안 턴에서 받은 `candidates` JSON**을 보존한 뒤, 사용자 승인 후 **그 스냅샷**으로만 `persistApprovedCandidates`를 호출해야 한다.

---

## 5. 타입 계약

**파일**: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts` (및 인접 타입 파일 분리는 구현 계획에서 결정)

### 5.1 `KnowledgeCandidate`

기존 필드에 추가:

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | `runOneTurn` 완료 시점에 항상 설정. 추출기 단독 테스트에서는 테스트가 직접 부여 가능. |

### 5.2 `PersonalKnowledgeAgentInput` / `PersonalKnowledgeAgentResult`

- **1단계 입력**: 기존과 동일 (`approvedCandidateIds` **넣지 않음** — 혼동 방지).  
- **1단계 결과**: `candidates` 각 항목에 `id` 포함. `persisted`는 **항상 `false`** 로 유지하거나, 하위 호환을 위해 유지하되 의미는 “이번 `runOneTurn`에서 remember 미실행”으로 문서화한다. (구현 시 후자가 변경 비용이 적으면 후자 채택.)

### 5.3 `PersonalKnowledgePersistInput` (신규)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `candidates` | `KnowledgeCandidate[]` | 예 | 직전 턴에서 받은 스냅샷과 동일해야 함 |
| `approvedCandidateIds` | `string[]` | 예 | 중복 허용 시 **중복 저장 시도로 해석하지 않음** — 구현에서 `Set`으로 한 번만 처리 |
| `projectId` | `string` | 아니오 | remember `project_id` |
| `ownerId` | `string \| string[]` | 아니오 | remember `owner_id` |
| `sessionId` / `processId` | `string` | 아니오 | Memori Attribution 필드 전달 |

`approvedCandidateIds`가 비어 있으면 **no-op**: `remember` 0회, 결과는 빈 배열·모든 항목 스킵.

### 5.4 `PersonalKnowledgePersistItemResult` (신규)

| 필드 | 타입 | 설명 |
|------|------|------|
| `candidateId` | `string` | 요청에 있던 id |
| `status` | `'persisted' \| 'skipped' \| 'error'` | `skipped`: 승인 목록에 없음(옵션으로 응답에 포함하지 않을 수 있음 — 구현 계획에서 “승인된 것만 배열 반환” vs “전체 승인 요청에 대한 대응표” 선택) |
| `memoryId` | `string?` | 성공 시 |
| `errorMessage` | `string?` | `status === 'error'`일 때 인간可読 메시지(내부 스택은 로깅용으로만) |

집계 필드(선택): `persistedCount`, `errorCount` — 호스트 편의용.

**권장 반환 형태**: **승인된 id 각각에 대해 한 행**만 반환(성공·실패). 승인 목록에 없는 `candidates`의 항목은 결과에 넣지 않는다. `approvedCandidateIds` 중 **`candidates`에 없는 id**는 `status: 'error'` 한 행으로 반환(잘못된 승인).

---

## 6. `IPersistencePort` 교체

**현재**

```ts
persist(candidates: KnowledgeCandidate[]): Promise<void>;
```

**변경 후 (의미적)**

```ts
persistApproved(input: PersonalKnowledgePersistInput): Promise<PersonalKnowledgePersistResult>;
```

- 구체적인 메서드명·결과 타입명은 구현 시 위 스펙과 1:1 대응되면 된다.  
- **목 구현**은 테스트에서 성공·실패·부분 실패를 시뮬레이션할 수 있어야 한다.

---

## 7. `KnowledgeCandidate` → `remember` 매핑

순수 함수 **단일 진입점**으로 두고, 카테고리별 특수 규칙을 한곳에 모은다.

| `suggestedMemoryType` | remember 필드 |
|----------------------|---------------|
| `semantic` / `episodic` / `working` | `content` ← `candidate.content`, `type` ← `suggestedMemoryType`, `tags`, `importance`, `project_id`, `owner_id`, `session_id`, `process_id` |
| `procedural` | `type: 'procedural'`, `task_goal`: `"개인 지식 에이전트 절차"` (고정 문자열 또는 `category` 기반 한 줄), `steps`: `candidate.content`를 줄 단위로 나누어 `[{ "step": n, "description": "<line>" }]` 형태의 **JSON 배열 문자열**. 줄이 `^\d+\.\s*` 형태면 해당 번호를 step으로 쓰고 description에서 접두 제거. |
| `core` / `vault` | 후보 추출기가 제안하지 않음(`SuggestedPersonalMemoryType`). 매퍼는 **도달 시 검증 오류**로 처리한다. |

- `source` (선택): `"personal-knowledge-agent"` 고정 권장.  
- `enable_triple_extraction`: `type === 'episodic'`이면 remember 기본과 맞추기 위해 **true** (또는 제품 정책에 따라 false — 구현 계획에서 확정).  
- `privacy_scope`: 기본 `private`.

---

## 8. 서비스 책임 분리

- **`PersonalKnowledgeAgentService`**  
  - `runOneTurn`: id 부여 → 기존 흐름 유지, **persistence 호출 없음**.  
  - `persistApprovedCandidates`: 입력 검증 → 승인된 후보만 순서대로(또는 `approvedCandidateIds` 순서) `deps.persistence.persistApproved` 호출.  
- **Persistence 어댑터**: `RememberTool` 실행에 필요한 `ToolContext`를 생성자로 보관하고, 각 후보마다 매핑된 파라미터로 `RememberTool.prototype.handle(params, context)`와 동일한 계약(`BaseTool`)을 호출한다. 인자 순서는 **`handle(params: RememberParams, context: ToolContext)`**.

---

## 9. 오류·부분 실패

- 특정 후보에서 `remember`가 실패해도 **나머지 승인 후보는 계속 시도**한다(이슈: 실패가 “전체 루프 결과에 명확히”).  
- 예외 전파 정책: **최종 반환값에 에러 행으로 수집**하고, 서비스 메서드는 **reject하지 않는 것**을 기본으로 한다. 입력 자체가 잘못된 경우(예: `candidates` 빈 배열인데 승인 id 존재)만 `throw` 허용.

---

## 10. 검증 (이슈 권장과 정합)

| 검증 | 내용 |
|------|------|
| 매퍼 단위 테스트 | 네 가지 `suggestedMemoryType` 중 실사용 세 가지 + procedural `steps` JSON 형태 |
| 서비스 통합 테스트 | 승인 0건 → remember 미호출; 승인 2건 중 1건 목 실패 → 결과 1 error 1 ok |
| 타입 체크 | `npm run type-check` |

---

## 11. 스펙 자체 점검 (체크리스트)

- [x] 미승인 저장 금지 — `approvedCandidateIds` 외부는 호출 안 함.  
- [x] 자동 저장 없음 — `runOneTurn`에 저장 경로 없음.  
- [x] 두 단계 모델과 제외 범위(서버 턴 스토어 없음) 모순 없음.  
- [x] `core`/`vault` 비도달 명시.

---

## 12. 구현 순서 힌트 (상세는 writing-plans)

1. 타입 추가 및 `KnowledgeCandidate.id` 채우기.  
2. `IPersistencePort` 및 목 갱신.  
3. 매퍼 + 매퍼 테스트.  
4. Remember 어댑터 + `persistApprovedCandidates`.  
5. 기존 `#234` 테스트 정책(`persist` 미호출) 유지·보강.
