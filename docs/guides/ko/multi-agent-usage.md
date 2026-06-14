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

`owner_id`를 지정하지 않으면 모든 기억을 소유자 구분 없이 검색합니다. 이는 기존 동작과 동일합니다.

조회 결과에는 각 기억 항목의 `owner_id`가 포함됩니다(`include_metadata: true` 설정 시).

## context.agentId 자동 설정

HTTP 서버나 MCP 클라이언트를 사용하는 환경에서는 세션 또는 요청 헤더에서 에이전트 식별자를 읽어 `ToolContext.agentId`에 설정할 수 있습니다. 이 방식을 사용하면 매 호출마다 `owner_id`를 명시하지 않아도 자동으로 소유권이 지정됩니다.

구체적인 구현 방식은 서버 레이어와 클라이언트 라이브러리 설정에 따라 다릅니다.

## 하위 호환성

owner_id 기능은 기존 코드와 완전히 하위 호환됩니다. 기존 데이터는 모두 `owner_id = NULL`을 유지하며, `owner_id`를 지정하지 않은 기존 코드는 변경 없이 이전과 동일하게 동작합니다. 새로운 필드를 사용해야만 다중 에이전트 분리 기능이 활성화됩니다.
