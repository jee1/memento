# 설계: 이슈 #236 — `memento agent ask` CLI (개인 지식 Agent 진입점)

**날짜**: 2026-05-14  
**이슈**: [#236](https://github.com/jee1/memento/issues/236)  
**부모**: [#82](https://github.com/jee1/memento/issues/82) 개인 지식 축적 Agent MVP  
**선행(완료)**: [#231](https://github.com/jee1/memento/issues/231) 계약, [#232](https://github.com/jee1/memento/issues/232) context builder, [#233](https://github.com/jee1/memento/issues/233) mock LLM, [#234](https://github.com/jee1/memento/issues/234) 후보 추출, [#235](https://github.com/jee1/memento/issues/235) 승인 기반 persistence  
**관련(별도 이슈)**: [#237](https://github.com/jee1/memento/issues/237) E2E·가이드, [#390](https://github.com/jee1/memento/issues/390) 서버 런타임 배선

**핵심 결정 요약**: **In-process** 실행, **`memento agent ask` nested 서브커맨드**, **core 쪽 in-process tool context 부트스트랩 헬퍼** 사용 또는 추가, **stdout JSON 계약**과 **단계별 exit code**.

---

## 1. 목표

1. `PersonalKnowledgeAgentService` 한 턴을 **CLI에서 end-to-end**로 실행해 MVP 루프를 검증한다.  
2. **HTTP MCP 서버 없이** mock LLM·실제 DB 경로(또는 프로젝트가 정한 테스트 DB 관례)로 동작 가능하게 한다.  
3. **기존** `recall` / `remember` / `forget` / `memory_injection` **동작·파싱·출력 관례를 깨지 않는다**.

---

## 2. 범위

### 포함

- 명령: **`memento agent ask`** (첫 토큰 `agent`, 둘째 `ask`).  
- 사용자 질문: **`ask` 직후 positional 인자 1개**를 `userMessage`로 사용한다(따옴표로 공백 포함). `--query` 등 이중 표기는 **이번 이슈에서 도입하지 않는다**(혼동 방지; 필요 시 후속 이슈).  
- 옵션(이슈 본문 + 브레인스토밍 합의):  
  - `--project-id <string>`  
  - `--token-budget <number>`  
  - `--json`  
  - `--no-save`  
  - `--llm mock` — **값은 `mock`만 허용**. 다른 값은 사용 오류(exit `1`). 플래그 자체는 이후 provider 연결(#238)을 위한 자리 확보.  
- 글로벌 옵션: 기존 CLI와 동일하게 **`--config-dir`**, deprecated **`--db-path`**, **`--env-file`** 을 **서브커맨드 앞·뒤** 모두에서 인식한다(기존 `parseGlobalFlags` / `subcommandArgvFrom` 패턴 재사용·확장).  
- **Interactive(TTY)**: `KnowledgeCandidate`마다 순차 프롬프트 **`y` / `n` / `s` / `q`**.  
  - **빈 줄**은 **`n`** 과 동일.  
  - **`s`**: 남은 후보에 대한 질문을 건너뛰고, **지금까지 `y`로 승인한 id만** `persistApprovedCandidates` 호출 후 정상 종료.  
  - **`q`**: 남은 후보를 묻지 않고, **`s`와 동일하게** 지금까지 `y`로 승인한 id만 `persistApprovedCandidates` 호출 후 정상 종료한다. 사용자에게 보이는 설명 문구만 다르게 할 수 있다(동작 동일).  
- **Non-interactive**: `process.stdin.isTTY === false` 인 경우 **`--json` 또는 `--no-save` 중 하나 이상 필수**. 둘 다 없으면 **exit `1`**, stderr에 이유 한 줄 이상.  
- **`--json`**: stdout에는 **JSON 한 줄**만(끝 `\n`). 성공 경로에서 stderr에 비-JSON 로그를 넣지 않는다.  
- **`--json` 단독(TTY 여부 무관)**: **인터랙션 비활성화**이며 **`--no-save`와 동등**으로 동작(저장 단계 생략). stderr에 **한 줄 안내**(문구는 구현 시 고정 문자열로 명시).  
- **`--json --no-save`**: 이슈 완료 기준 — **stdout에 JSON만**.  
- **성공 시 JSON 스키마**: 단일 객체, 필드는 아래 **§6**.  
- **실패 시 JSON 스키마**: **§7**.  
- **Exit code**: **§8**.  
- **부트스트랩**: `ToolContextKnowledgeContextAdapter` / `ToolContextRememberPersistenceAdapter`에 넣을 **in-process tool context** 생성을 `@memento/core`에 **팩토리 또는 헬퍼**로 둔다. `apps/experimental-example` 등 기존 in-process 사용처를 먼저 조사하고, **중복이면 헬퍼로 승격**, 없으면 **이번 작업 범위에서 추가**. CLI 파일은 표현·argv·TTY만 담당한다.  
- **식별자**: 매 CLI 호출마다 `sessionId = randomUUID()`, `processId = "cli/agent-ask"`(상수). **`ownerId`는 설정하지 않는다**(undefined). `--session-id` 사용자 override는 **이번 이슈 범위에 넣지 않는다**.  
- **후보 0개**: 승인 루프 생략. `persistApprovedCandidates`는 **`approvedCandidateIds`가 비어 있으면 호출하지 않는다**(#235 no-op과 정합).  
- 테스트: Vitest로 `--json --no-save` stdout 파싱, 필수 필드, `ok === true`, mock 메타데이터; 기존 CLI 스펙 회귀.

### 제외 (이슈 본문과 동일)

- 웹 UI  
- **MCP tool 추가**  
- **실제 LLM provider** 연결 — [#238](https://github.com/jee1/memento/issues/238) 및 하위 이슈  
- 서버 HTTP 경로로의 `agent ask` 위임 — [#390](https://github.com/jee1/memento/issues/390) 등 별도 트랙

---

## 3. 아키텍처 (채택안)

| 대안 | 요지 | 채택 |
|------|------|------|
| A | CLI가 core를 in-process 부트스트랩 | **예** |
| B | `callToolViaHttp`로 서버에 위임 | 아니오(MCP 제외·서버 미기동 요건과 충돌) |
| C | context만 HTTP, 나머지 in-process | 아니오(MVP 복잡도) |

**데이터 흐름**

1. argv 파싱 → (기존과 동일) env 로드.  
2. core 헬퍼로 SQLite·embedding 등 초기화 및 **tool context** 획득.  
3. `PersonalKnowledgeAgentService` 인스턴스 생성(`DeterministicMockLlmAdapter`, context adapter, persistence adapter).  
4. `runOneTurn(input)` — `input`에 `userMessage`, `projectId`, `tokenBudget` 등 반영.  
5. `--no-save` 또는 `--json` 단독(자동 no-save)이면 **persist 단계를 생략**하고, JSON에 `persistence.attempted: false`.  
6. 그 외 TTY: 후보별 순차 승인 → `persistApprovedCandidates({ candidates, approvedCandidateIds, projectId, sessionId, processId })`.

---

## 4. CLI 파싱·도움말

- **도움말**: `memento --help`에 `agent ask` 한 줄 설명 추가. `memento agent --help` 또는 `memento agent ask --help`는 구현 계획에서 최소 한 경로는 제공(중복 시 하나만 유지).  
- **알 수 없는 토큰**: 기존과 동일하게 stderr + exit `1`.  
- **`agent` 뒤가 `ask`가 아님**: “알 수 없는 agent 서브커맨드” + exit `1`.

---

## 5. stdout / stderr 규칙

| 모드 | stdout | stderr |
|------|--------|--------|
| `--json` 성공 | JSON 한 줄 | 비움 |
| `--json` 실패 | JSON 한 줄(`ok: false`) | 비움(메시지는 JSON 내부) |
| `--json` 단독 시 안내 | JSON 한 줄(성공 시) | **한 줄** `[info] --json은 인터랙션을 비활성화합니다(저장 생략).` 등 고정 문구 |
| 사람 읽기 모드( `--json` 없음, TTY) | 구현 계획에서 **한 가지로 고정**(예: 최종 요약 JSON 한 줄만 stdout, 나머지 사람 읽기 텍스트는 stderr) — **기존 4개 서브커맨드는 항상 stdout에 JSON만**이므로, `agent ask`만 예외를 두면 문서·테스트에 명시한다. **권장**: 사람 읽기 모드에서도 **마지막에 성공 요약 JSON 한 줄을 stdout**에 붙여 파이프 일관성 유지, 진행 로그는 stderr. |
| `--no-save`만 (TTY, `--json` 없음) | 위와 동일 정책 | 진행·후보 표시 |

**상호 배타**: `--json` 성공 경로에서 stderr에 임의 로그를 섞지 않는다.

---

## 6. JSON 성공 스키마

최상위 객체(한 줄 직렬화):

| 필드 | 타입 | 설명 |
|------|------|------|
| `ok` | `true` | |
| `sessionId` | `string` | 이번 호출의 `randomUUID()` |
| `input` | `object` | `userMessage`, `projectId`, `tokenBudget` 등 실제 전달값 |
| `knowledgeContext` | `object` | `itemCount`, `tokenEstimate`, `summary` (#232 메타와 대응) |
| `llm` | `object` | `response: string`, `metadata` — mock provider 메타 포함 |
| `candidates` | `array` | `KnowledgeCandidate` 전 필드; **`sourceContext` 있으면 포함** |
| `persistence` | `object` | 아래 |

`persistence`:

| 필드 | 타입 | 설명 |
|------|------|------|
| `attempted` | `boolean` | `persistApprovedCandidates` 호출 여부 |
| `items` | `array` | #235 결과 항목과 동일 형태(후보별 `candidateId`, `status`, `memoryId?`, `errorMessage?`) |
| `persistedCount` | `number` | |
| `errorCount` | `number` | |

`attempted === false` 인 경우: `items`는 `[]`, count는 `0`.

---

## 7. JSON 실패 스키마

```json
{
  "ok": false,
  "error": {
    "code": "MISSING_QUERY" | "INVALID_OPTION" | "BOOTSTRAP_FAILED" | "AGENT_RUN_FAILED" | "PERSIST_FAILED" | "INTERRUPTED" | "NON_INTERACTIVE",
    "stage": "usage" | "bootstrap" | "run" | "persist",
    "message": "string",
    "details": {}
  }
}
```

- `PERSIST_FAILED` 시 `details`에 후보별 오류를 넣을 수 있다(구현 계획에서 필드명 고정).  
- **비-JSON 모드** 실패: stderr에 `message` 한 줄 이상; exit code는 **§8**.

---

## 8. Exit code

| 코드 | 조건 |
|------|------|
| `0` | 정상 종료 |
| `1` | 사용 오류(인자 누락·잘못된 옵션·non-TTY 제약 위반 등) — `stage: usage` |
| `2` | 부트스트랩 실패 — `stage: bootstrap` |
| `3` | `runOneTurn` 실패 — `stage: run` |
| `4` | persist 중 하나 이상 실패(부분 성공 포함) — `stage: persist` |
| `130` | SIGINT(Ctrl+C) — **저장하지 않음**. **필수**: stderr에 중단 안내, exit `130`. **`--json` 모드**: 처리 비용이 낮으면 stdout에 완결된 한 줄 JSON(`ok: false`, `code: INTERRUPTED`)을 추가로 출력해도 좋다(권장). **금지**: stdout에 잘린 JSON만 남기는 것. |

**부분 persist**: 성공한 `remember`는 유지하고 **롤백하지 않는다**(MVP).

**스택 트레이스**: 기본 출력 금지. 환경 변수 **`MEMENTO_DEBUG=1`** 일 때만 stderr에 스택(또는 cause chain) 출력.

---

## 9. 구현 시 조사 항목 (필수)

1. `apps/experimental-example` 및 core 내부에 **이미 동일한 in-process tool context** 생성 코드가 있는지 확인한다.  
2. 없으면 `packages/memento-core` 적절한 모듈(예: `personal-agent` 또는 `infrastructure`)에 **`createPersonalAgentToolContext` 수준의 단일 진입점**을 추가하고, CLI는 그것만 호출한다.  
3. DB 경로: 프로젝트의 기존 CLI·테스트가 사용하는 **`--config-dir` 해석**과 충돌하지 않게 맞춘다.

---

## 10. 테스트·회귀

- **신규**: `agent ask` + `--json --no-save` 통합 테스트(임시 DB 파일 경로는 기존 Vitest 패턴 따름).  
- **회귀**: `packages/memento-server/src/cli/cli-ac5-ac6.spec.ts` 등 기존 CLI 테스트 전부 통과.  
- **수동**: 이슈 권장대로 `memento agent ask "..." --json --no-save` 한 번 이상.

---

## 11. 이슈 본문과의 정합

| 이슈 요구 | 본 설계 |
|-----------|---------|
| `memento agent ask` | nested `agent` + `ask` |
| `--project-id`, `--token-budget`, `--json`, `--no-save` | 포함 |
| interactive 승인 | §2 |
| non-interactive test mode | §2 non-TTY 규칙 |
| `--json --no-save` → stdout JSON only | §5 |
| mock E2E | in-process + `DeterministicMockLlmAdapter` |
| 기존 4 명령 회귀 | §2, §10 |

---

## 12. 다음 단계

- 사용자가 본 spec 파일을 검토·승인하면 **writing-plans** 스킬에 따라 `tasks.md` 수준의 구현 계획을 작성한다.  
- 구현 시 본 문서 §5의 “사람 읽기 모드 stdout/stderr” 최종 한 가지 선택을 코드와 테스트에 반영한다.
