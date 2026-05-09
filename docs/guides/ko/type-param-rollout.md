# MCP `type` 파라미터 롤아웃 가이드

## 요약

- `remember` / `recall` 등 메모리 도구에서는 가능하면 **`type`을 항상 명시**하는 것이 좋다.
- 복수 타입을 한 번에 필터링하려면 `recall`의 **`memory_types`** 를 사용할 수 있다. `memory_types`만으로도 타입 필터 의도가 드러나므로, `recall`에서는 **첫 번째** missing-`type` 경고(`validateTypeParam`)가 생략될 수 있다(세부 동작은 릴리스 노트·코드 주석 참고).

## 환경 변수 `MEMENTO_TYPE_PARAM_MODE`

- `warn`(기본): `type`이 없고 `memory_types`도 비어 있으면 기본값 `episodic`을 쓰며 경고를 남길 수 있다.
- `deprecate`: 위와 같은 경우 경고 문구에 마이그레이션 안내(링크)가 포함된다.
- `error`(엄격): `recall`에서 **`type`이 없고 `memory_types`도 비어 있거나 없을 때** 호출이 거절된다. 반면 **`memory_types`만** 넘긴 호출은 타입 필터 의도가 있다고 보아 거절하지 않는다(내부 기본 분기는 기존과 동일).

배포 환경에서 단계적으로 `warn` → `deprecate` → `error`로 올려 클라이언트를 정리할 수 있다.

## 권장 마이그레이션

1. 모든 `recall` 호출에 명시적으로 `type`을 넣는다 (예: 하이브리드 검색: `episodic` 외 타입이 필요하면 해당 타입).
2. 복수 타입이 필요하면 `memory_types` 배열을 사용하고, 가능하면 **`type`도 함께 지정**해 의도를 명확히 한다.
