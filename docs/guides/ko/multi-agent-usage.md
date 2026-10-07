# 다중 에이전트 사용 가이드

## 왜 에이전트 소유권이 필요한가

하나의 Memento 인스턴스를 여러 AI 에이전트가 공유하면, 각 에이전트가 서로의 기억을 오염시키거나 다른 에이전트의 기억을 자신의 컨텍스트로 혼동할 위험이 생깁니다. 코드 리뷰 에이전트, 문서 작성 에이전트, 배포 에이전트가 같은 DB를 사용한다면 각자의 작업 맥락이 섞이지 않아야 합니다.

Memento는 이를 위해 `owner_id` 필드를 지원합니다. 기억을 저장할 때 소유 에이전트를 명시하고, 조회할 때 해당 에이전트의 기억만 필터링할 수 있습니다.

## owner_id 개념

`owner_id`는 각 기억 항목에 붙는 소유자 식별자입니다. 두 가지 상태가 가능합니다.

`NULL`은 소유자 미지정 상태입니다. 단일 에이전트 환경이나, 기존 코드에서 owner_id를 지정하지 않고 저장한 기억들이 이 상태입니다. 레거시 데이터는 모두 NULL입니다.

문자열 값은 특정 에이전트의 소유를 나타냅니다. `"agent-a"`, `"code-reviewer"`, `"user-1234"` 같은 형식으로 자유롭게 지정할 수 있습니다.

## 저장 시 소유권 지정 (remember / remember_procedure)

`remember` 또는 `remember_procedure` 도구 호출 시 `owner_id`를 파라미터로 전달하면 그 값이 기억에 저장됩니다.

```json
{
  "content": "이 프로젝트는 TypeScript 엄격 모드를 사용한다",
  "type": "semantic",
  "owner_id": "code-reviewer"
}
```

파라미터에 `owner_id`를 넣지 않더라도, MCP/HTTP 레이어에서 `ToolContext.agentId`에 에이전트 식별자가 설정되어 있으면 그 값이 자동으로 사용됩니다. 두 값 모두 없으면 `owner_id`는 NULL로 저장됩니다.

## 조회 시 필터링 (recall)

`recall` 도구의 `owner_id` 파라미터에 값을 지정하면, 해당 소유자의 기억만 반환됩니다. 배열로 여러 소유자를 동시에 지정할 수도 있습니다.

```json
{
  "query": "TypeScript 설정",
  "owner_id": "code-reviewer"
}
```

```json
{
  "query": "배포 절차",
  "owner_id": ["deploy-agent", "devops-agent"]
}
```

`owner_id`를 지정하지 않으면 MCP·레거시 경로는 소유자 구분 없이 전체 검색합니다. **HTTP `/tools/recall`·`/tools/memory_injection`만** owner-scope 미들웨어가 적용되며, 기본값 `MEMENTO_OWNER_SCOPE_MODE=strict`에서는 `owner_id`가 없을 때 요청 헤더·환경 변수에서 읽은 에이전트 ID로 자동 필터됩니다. MCP는 파라미터 `owner_id`로만 격리합니다.

조회 결과에는 각 기억 항목의 `owner_id`가 포함됩니다(`include_metadata: true` 설정 시).

## HTTP owner scope (strict / warn / off)

HTTP programmatic API(`/tools/*`)는 다중 에이전트 환경에서 타 에이전트 기억 유출을 막기 위해 owner scope를 적용할 수 있습니다. 이 미들웨어는 **HTTP `/tools`에만** 적용됩니다(관련 설계: GitHub [#664](https://github.com/jee1/memento/issues/664)).

| 환경 변수 | 값 | 동작 |
|-----------|-----|------|
| `MEMENTO_OWNER_SCOPE_MODE` | `strict` (기본) | `recall` / `memory_injection`에 `owner_id`가 없고 에이전트 ID(`X-Memento-Agent-Id` 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID`)가 있으면 그 값으로 `owner_id`를 자동 주입. **식별자가 없으면 400** |
| | `warn` | 에이전트 ID가 있으면 `strict`와 같이 `owner_id`를 주입. **식별자가 없을 때만** 경고 로그 후 레거시(전체) 조회 허용 |
| | `off` | 강제 없음 (레거시와 동일) |

### 에이전트 ID 전달

HTTP `/tools`에서 쓰는 식별자:

1. **요청 헤더** (권장): `X-Memento-Agent-Id: code-reviewer`
2. **서버 기본값**: `MEMENTO_HTTP_DEFAULT_AGENT_ID=code-reviewer` (헤더가 없을 때만)

헤더·환경 변수로 읽은 값은 `ToolContext.agentId`에 설정되며, `strict`/`warn`에서 `owner_id` 미지정 recall에 자동으로 사용됩니다.

> `X-Agent-Id`는 MCP HTTP·audit 경로용입니다. `/tools` owner scope에는 `X-Memento-Agent-Id`(+ `MEMENTO_HTTP_DEFAULT_AGENT_ID`)를 쓰세요.

```bash
# MEMENTO_API_TOKENS 에 tools:invoke 스코프 토큰을 두고 사용 (권장)
curl -sS -X POST http://127.0.0.1:9001/tools/recall \
  -H "Authorization: Bearer $MEMENTO_API_TOKEN" \
  -H "X-Memento-Agent-Id: code-reviewer" \
  -H "Content-Type: application/json" \
  -d '{"query":"TypeScript 설정","type":"semantic"}'
```

> `ADMIN_API_KEY` Bearer 는 v2.0.0(#1241)부터 거절됩니다. `MEMENTO_API_TOKENS` 의 토큰 secret 을 쓰세요.

### 토큰에 agent 묶기 (#1258)

헤더 값은 클라이언트가 마음대로 정한다. 같은 `tools:invoke` 토큰으로 헤더만 바꾸면 다른 agent 행세가 된다. 막으려면 토큰 항목에 `agent_id` 를 둔다.

```bash
MEMENTO_API_TOKENS='[{"id":"codex","secret":"<hex>","scopes":["tools:invoke"],"agent_id":"codex"}]'
```

- 이 토큰으로 온 요청의 `ToolContext.agentId` 는 항상 `codex` 다. 헤더가 없어도 된다
- `X-Memento-Agent-Id`·`X-Agent-Id` 가 다른 값이면 **403** (`AGENT_ID_MISMATCH`)
- `agent_id` 가 빈 문자열이거나 문자열이 아니면 그 토큰 항목 전체가 무시된다
- `agent_id` 없는 토큰은 위 헤더 규칙 그대로

forget owner scope(#1094)·strict recall 필터·감사 로그가 모두 이 값을 쓰므로, 에이전트마다 토큰을 따로 발급할 때 함께 설정한다. 도구 인자 `owner_id` 로 다른 owner 를 지정하는 경로는 이 설정의 영향을 받지 않는다.

### 레거시 NULL 데이터 opt-out

기존 DB에 `owner_id = NULL`인 기억이 많고, HTTP recall에서 **소유자 미지정 전체 조회**를 유지해야 한다면:

- 단기: `MEMENTO_OWNER_SCOPE_MODE=warn` — 에이전트 ID가 없을 때 경고만 남기고 전체 조회 유지(ID가 있으면 여전히 주입)
- 완전 해제: `MEMENTO_OWNER_SCOPE_MODE=off`

`strict`/`warn`에서 에이전트 스코프로 필터된 recall에는 `owner_id`가 NULL인 기억이 **포함되지 않습니다**. NULL 데이터를 계속 공유하려면 마이그레이션으로 `owner_id`를 채우거나, 위 opt-out을 사용하세요.

## context.agentId 자동 설정

HTTP `/tools`는 `X-Memento-Agent-Id` 요청 헤더(대소문자 무시) 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID` 환경 변수에서 에이전트 식별자를 읽어 `ToolContext.agentId`에 설정합니다. MCP stdio 경로는 클라이언트·어댑터가 `context.agentId`를 설정하는 방식을 그대로 사용하며, owner-scope 미들웨어는 타지 않습니다(파라미터 `owner_id`로만 격리).

HTTP owner scope와의 연동은 위 **HTTP owner scope** 절을 참고하세요.

## 프로젝트 기본값 (X-Memento-Project-Id, #1270)

HTTP `/mcp`·`/tools`는 `X-Memento-Project-Id` 요청 헤더(최대 200자, 공백만 있으면 무시)를 읽어 `ToolContext.projectId`에 설정합니다. `remember`는 **신규 저장**에서 `project_id` 인자를 생략했을 때만 이 값을 기본 `project_id`로 씁니다. 명시 `project_id` 인자가 항상 우선합니다. `memory_id`·`update_mode`로 기존 기억을 갱신할 때는 헤더를 적용하지 않습니다(기존 `project_id` NULL 행 갱신이 깨지지 않도록). `recall`·`memory_injection` 필터는 변경되지 않으며, `project_id`를 주지 않으면 여전히 전체 프로젝트를 검색합니다. 헤더가 없으면 동작은 이전과 같습니다.

Claude Code 예시(저장소별 로컬 scope, 커밋하지 않음):

```bash
claude mcp add --scope local --transport http memento http://localhost:9001/mcp \
  --header "X-API-Key: <key>" --header "X-Memento-Project-Id: memento"
```

## 프로젝트 브리프 (include_project_brief, #1271)

여러 AI 가 한 프로젝트를 이어받을 때 읽을 기준 문서입니다. 브리프는 별도 테이블이 아니라 `project_id` 와 태그 `project-brief` 를 가진 기억이며, 같은 프로젝트에 여러 행이 있으면 `created_at` 이 가장 최근인 행이 현재 판입니다.

- **작성**: `remember(type: "semantic", tags: ["project-brief"], project_id: "<프로젝트>", content: "<기획·결정·다음 할 일>")` — 헤더가 있으면 `project_id` 생략 가능
- **갱신**: `remember(memory_id, update_mode: "replace", expected_version, project_id, ...)` — 다른 AI 가 먼저 고쳤으면 `memory_version_conflict`(409). 갱신은 헤더를 쓰지 않으므로 `project_id` 를 명시합니다
- **주입**: `memory_injection(include_project_brief: true)` 는 질의와 무관하게 브리프 전문을 결과 맨 앞에 싣고 응답에 `project_brief: { memory_id, project_id, version, included }` 를 붙입니다. 브리프는 `token_budget` 과 별도입니다. 기본(`false`) 호출에는 브리프가 있을 때 포인터 한 줄만 붙습니다
- 프로젝트는 `project_id` 인자 → `X-Memento-Project-Id` 순으로 정합니다. 검색 필터에는 영향이 없고, 프로젝트를 알 수 없으면 결과가 이전과 같습니다. `owner_id` 를 주면 브리프도 그 소유자 것만 봅니다

매 턴 전문을 실으면 턴마다 같은 문서가 반복되므로 `true` 는 세션 시작과 compact 직후에만 씁니다. 훅이 있는 클라이언트(Claude Code `SessionStart`, Codex `SessionStart`)는 그 훅에서 `true` 호출을 지시하고, 훅이 없는 클라이언트는 도구 설명의 안내를 따릅니다.

## 오케스트레이션 템플릿 (#673)

여러 reader 에이전트 + **단일 writer** 패턴의 참조 구현:

- [`apps/multi-agent-orchestration/README.md`](../../../apps/multi-agent-orchestration/README.md)
- GitHub [#673](https://github.com/jee1/memento/issues/673) — orchestration 템플릿

owner scope·writer 격리 설계는 [#664](https://github.com/jee1/memento/issues/664)를 참고하세요.

## Compare-and-swap 갱신 (Issue #1093 Phase 1)

다중 에이전트가 같은 `memory_id`를 갱신할 때 race를 막으려면 `remember`에 `expected_version`을 함께 보냅니다.

```json
{
  "type": "semantic",
  "memory_id": "mem_abc123",
  "update_mode": "replace",
  "expected_version": 1,
  "content": "갱신된 내용",
  "owner_id": "code-reviewer",
  "project_id": "my-project"
}
```

- `memory_item.version`이 NULL이면 **1**로 간주합니다. 성공 시 `version`이 1 증가하고 응답에 새 `version`이 포함됩니다.
- `expected_version`을 생략하면 기존과 동일하게 무조건 갱신합니다(version 컬럼은 건드리지 않음).
- `owner_id`·`project_id` 스코프가 다르면 갱신되지 않습니다(타 소유자 데이터 노출 없음).
- 버전 불일치는 HTTP `/tools/remember` **409** (`memory_version_conflict`)입니다.

## 하위 호환성

owner_id 기능은 기존 코드와 완전히 하위 호환됩니다. 기존 데이터는 모두 `owner_id = NULL`을 유지하며, `owner_id`를 지정하지 않은 기존 코드는 변경 없이 이전과 동일하게 동작합니다. 새로운 필드를 사용해야만 다중 에이전트 분리 기능이 활성화됩니다.

> **HTTP 참고:** 위 하위 호환 설명은 MCP·구코드 경로 기준입니다. HTTP `/tools/recall`·`/tools/memory_injection`은 기본 `MEMENTO_OWNER_SCOPE_MODE=strict`라서, `owner_id`를 생략해도 에이전트 ID로 자동 필터되거나(없으면 400) NULL 기억이 스코프 결과에 안 잡힐 수 있습니다. 전체 조회가 필요하면 `warn`/`off` 또는 위 «레거시 NULL 데이터 opt-out»을 보세요.
