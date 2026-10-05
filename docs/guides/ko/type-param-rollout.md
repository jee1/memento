# MCP `type` 파라미터 가이드

`remember`와 `recall`은 **`type`이 필수**이며, 생략하면 호출을 거절합니다. “어떤 종류의 기억인지”를 호출자가 명시해야 검색 품질과 망각 정책이 의도대로 동작합니다.

## 이력

- v1.18: `MEMENTO_TYPE_PARAM_MODE` 기본값을 `error` 로 바꿨고, `warn`/`deprecate` 로 레거시 클라이언트가 `episodic` 기본값을 쓰며 옮겨 갈 수 있었습니다 (#636).
- v2.0.0: `MEMENTO_TYPE_PARAM_MODE` 와 `warn`/`deprecate` 모드를 제거했습니다 (#1242). 남아 있는 환경 변수는 무시됩니다.

## 권장 마이그레이션

모든 `recall` 호출에 검색 대상 타입을 명시합니다. 한 타입만 필요하면 `type` 하나로 충분하고, 여러 타입을 동시에 보려면 `memory_types` 배열**만** 씁니다. `type` 과 `memory_types` 를 함께 주면 `type` 이 우선하고 `memory_types` 는 무시됩니다.

## 관련 문서

- [Core Deprecated API Inventory](../../architecture/core-deprecated-inventory.md) — `type` 파라미터 롤아웃 이력
