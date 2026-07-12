# Memento 리소스 URI (#656)

Memento는 기억과 관련 리소스를 외부 응답·export·향후 outbox/audit에서 일관되게 가리키기 위해 canonical URI를 사용합니다. 이 URI는 기존 내부 ID를 대체하지 않는 **추가 식별자**입니다.

## Canonical 형식

```
memento://{owner}/{resource-kind}/{id}
```

| resource-kind | 예시 | 대상 |
|---|---|---|
| `memory` | `memento://agent-a/memory/mem_123` | working, episodic, semantic memory |
| `procedure` | `memento://agent-a/procedure/mem_456` | procedural memory |
| `anchor` | `memento://agent-a/anchor/A` | owner의 anchor slot |
| `relation` | `memento://agent-a/relation/42` | source memory가 `agent-a`인 relation |

`owner_id`가 `NULL` 또는 빈 문자열인 기존 memory row는 `default` owner로 표기합니다. relation은 별도 owner를 저장하지 않으므로 source memory의 owner를 사용합니다.

URI component의 공백, `/`, `%` 등은 percent encoding합니다. 예를 들어 ID `mem/a b%`는 `mem%2Fa%20b%25`가 됩니다.

## API 노출

- `recall` 항목은 기존 `memory_id`와 `id`를 유지하고 `uri`를 추가합니다.
- `feedback` 성공 응답은 대상 memory의 `uri`를 포함합니다.
- `add_relation`과 `get_relations`은 `uri`, `source_uri`, `target_uri`를 포함합니다.
- `export`의 Markdown frontmatter와 JSONL 레코드는 `uri`를 포함합니다.

기존 `mem_*` ID는 입력·조회·저장에 계속 사용됩니다. caller는 URI가 필요하지 않은 기존 계약을 바꿀 필요가 없습니다.

## 호환성

MCP `resources/list`와 `resources/read`의 `memory://{id}`는 MCP resource transport용 기존 URI이며 계속 지원됩니다. 그것은 canonical Memento URI가 아닙니다.

`source` 필드는 이전 `memento://memory/{id}`를 migration alias로 계속 허용합니다. 새 source 값과 새 응답은 owner-scoped canonical 형식을 사용해야 합니다.

## 예시

```json
{
  "memory_id": "mem_1700000000_abc",
  "uri": "memento://default/memory/mem_1700000000_abc"
}
```

```json
{
  "relation_id": 42,
  "uri": "memento://agent-a/relation/42",
  "source_uri": "memento://agent-a/memory/mem_source",
  "target_uri": "memento://agent-b/procedure/mem_target"
}
```
