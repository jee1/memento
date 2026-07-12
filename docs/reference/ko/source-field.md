# source 필드 표준 (#671)

`remember`·`remember_procedure`의 `source` 파라미터는 기억의 **출처(provenance)** 를 기계가 파싱 가능한 URI로 기록합니다. 자유 텍스트 대신 아래 형식을 사용하면 recall·export·감사 로그에서 일관되게 추적할 수 있습니다.

## 지원 URI 형식

| 형식 | 예시 | 용도 |
|------|------|------|
| `file://` | `file:///home/user/notes/design.md` | 로컬 파일·저장소 경로 |
| `https://` | `https://github.com/org/repo/pull/42` | 웹 문서·이슈·PR |
| `commit:` | `commit:abc1234def5678` | Git 커밋 SHA (7–64자 hex) |
| `doc:` | `doc:security-guide-v2` | 내부 문서 ID |
| `memento://{owner}/{kind}/{id}` | `memento://agent-a/memory/mem_123_abc` | 다른 Memento 리소스 참조 |
| `memento://memory/` | `memento://memory/mem_123_abc` | 기존 source 값용 legacy alias |

`source`는 **선택 필드**입니다. 생략하면 `NULL`로 저장됩니다.

## 검증 동작

- **기본 (관대)**: 형식이 맞지 않으면 **경고 로그**만 남기고 저장을 계속합니다.
- **strict**: `MEMENTO_SOURCE_STRICT=true` 이면 잘못된 `source`로 **remember 요청을 거절**합니다.

```bash
# strict 모드 (CI·프로덕션 권장)
export MEMENTO_SOURCE_STRICT=true
```

구현: `packages/memento-core/src/shared/validation/source-uri.ts` 의 `validateSource()`.

## remember 예시

```json
{
  "content": "JWT 만료 시 refresh 토큰으로 갱신한다",
  "type": "semantic",
  "source": "https://docs.example.com/auth/jwt",
  "tags": ["auth", "jwt"]
}
```

```json
{
  "content": "이전 회의 결정을 인용",
  "type": "episodic",
  "source": "memento://default/memory/mem_1700000000_abc"
}
```

## recall·export에서의 round-trip

`remember` 시 저장한 `source`는 `recall` 응답(`include_metadata: true`, 기본)의 각 항목 `source` 필드로 반환됩니다. Admin `GET /admin/export?format=markdown` 및 `export` 도구의 YAML frontmatter에도 동일 값이 포함됩니다.

## 마이그레이션

기존 자유 텍스트 `source` 값은 즉시 삭제되지 않습니다. strict 모드 전에 데이터를 점검하고, 필요 시 `https://` 또는 `doc:` 형식으로 재저장하세요.

## 관련 문서

- [보안 참고](./security.md)
- [Memento 리소스 URI](./resource-uri.md)
- [다중 에이전트 사용 가이드](../../guides/ko/multi-agent-usage.md)
