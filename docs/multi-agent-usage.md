# 다중 에이전트 사용 가이드

**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) Phase 2 D (다중 에이전트)

## 개요

`memory_item`에 **owner_id** 필드가 추가되어, 여러 에이전트가 동일 Memento 인스턴스를 사용할 때 소유자별로 메모리를 구분·필터링할 수 있습니다.

## owner_id 의미

- **NULL**: 소유자 미지정 (단일 에이전트 또는 레거시 행).
- **문자열**: 해당 메모리의 소유자/에이전트 식별자 (예: `"agent-a"`, `"default"`).

## 저장 시 (remember / remember_procedure)

- **owner_id 파라미터**: 호출 시 `owner_id`를 넘기면 그 값이 저장됩니다.
- **context.agentId**: 파라미터에 `owner_id`가 없으면 `ToolContext.agentId`가 사용됩니다. HTTP/MCP 레이어에서 세션·헤더 기반으로 채울 수 있습니다.
- **둘 다 없음**: `owner_id`는 NULL로 저장됩니다 (기존 동작과 동일).

## 조회 시 (recall)

- **owner_id 파라미터**: `owner_id`에 문자열 또는 문자열 배열을 주면, 해당 소유자(들)의 메모리만 반환됩니다. 미설정 시 전체 조회(기존 동작)입니다.
- 응답 항목에 `owner_id`가 포함됩니다 (`include_metadata` true 시).

## context.agentId 설정

- **MCP/CLI**: 도구 실행 시 `ToolContext`에 `agentId`를 넣어 주면, remember/remember_procedure에서 파라미터로 `owner_id`를 넘기지 않아도 해당 값이 저장됩니다.
- **HTTP 서버**: 세션·헤더에서 에이전트 식별자를 읽어 `context.agentId`에 설정하는 로직은 인프라 레벨에서 구현할 수 있습니다.

## 하위 호환성

- 기존 데이터는 `owner_id = NULL`로 유지됩니다.
- `owner_id`를 지정하지 않으면 이전과 동일하게 동작합니다.
