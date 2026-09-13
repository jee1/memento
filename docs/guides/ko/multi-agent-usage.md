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

> 레거시: `ADMIN_API_KEY` Bearer도 동작할 수 있으나 deprecated입니다. 새 연동은 `MEMENTO_API_TOKENS`를 쓰세요.

### 레거시 NULL 데이터 opt-out

기존 DB에 `owner_id = NULL`인 기억이 많고, HTTP recall에서 **소유자 미지정 전체 조회**를 유지해야 한다면:

- 단기: `MEMENTO_OWNER_SCOPE_MODE=warn` — 에이전트 ID가 없을 때 경고만 남기고 전체 조회 유지(ID가 있으면 여전히 주입)
- 완전 해제: `MEMENTO_OWNER_SCOPE_MODE=off`

`strict`/`warn`에서 에이전트 스코프로 필터된 recall에는 `owner_id`가 NULL인 기억이 **포함되지 않습니다**. NULL 데이터를 계속 공유하려면 마이그레이션으로 `owner_id`를 채우거나, 위 opt-out을 사용하세요.

## context.agentId 자동 설정

HTTP `/tools`는 `X-Memento-Agent-Id` 요청 헤더(대소문자 무시) 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID` 환경 변수에서 에이전트 식별자를 읽어 `ToolContext.agentId`에 설정합니다. MCP stdio 경로는 클라이언트·어댑터가 `context.agentId`를 설정하는 방식을 그대로 사용하며, owner-scope 미들웨어는 타지 않습니다(파라미터 `owner_id`로만 격리).

HTTP owner scope와의 연동은 위 **HTTP owner scope** 절을 참고하세요.

## 오케스트레이션 템플릿 (#673)

여러 reader 에이전트 + **단일 writer** 패턴의 참조 구현:

- [`apps/multi-agent-orchestration/README.md`](../../../apps/multi-agent-orchestration/README.md)
- GitHub [#673](https://github.com/jee1/memento/issues/673) — orchestration 템플릿

owner scope·writer 격리 설계는 [#664](https://github.com/jee1/memento/issues/664)를 참고하세요.

## 하위 호환성

owner_id 기능은 기존 코드와 완전히 하위 호환됩니다. 기존 데이터는 모두 `owner_id = NULL`을 유지하며, `owner_id`를 지정하지 않은 기존 코드는 변경 없이 이전과 동일하게 동작합니다. 새로운 필드를 사용해야만 다중 에이전트 분리 기능이 활성화됩니다.

> **HTTP 참고:** 위 하위 호환 설명은 MCP·구코드 경로 기준입니다. HTTP `/tools/recall`·`/tools/memory_injection`은 기본 `MEMENTO_OWNER_SCOPE_MODE=strict`라서, `owner_id`를 생략해도 에이전트 ID로 자동 필터되거나(없으면 400) NULL 기억이 스코프 결과에 안 잡힐 수 있습니다. 전체 조회가 필요하면 `warn`/`off` 또는 위 «레거시 NULL 데이터 opt-out»을 보세요.
