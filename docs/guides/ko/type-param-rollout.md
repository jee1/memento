# MCP `type` 파라미터 롤아웃 가이드

v1.18부터 Memento는 `remember`와 `recall`에서 **`type`을 생략하면 호출을 거절**합니다. 이는 “어떤 종류의 기억인지”를 호출자가 명시하도록 강제해, 검색 품질과 망각 정책이 의도대로 동작하게 하기 위함입니다. 레거시 클라이언트를 단계적으로 옮기는 동안에는 환경 변수로 완화 모드를 켤 수 있습니다.

## 환경 변수 `MEMENTO_TYPE_PARAM_MODE`

`MEMENTO_TYPE_PARAM_MODE`는 서버가 `type` 누락을 어떻게 처리할지 정합니다.

- **`error`**(기본, v1.18+): `type`이 없으면 호출이 거절됩니다. 신규 배포는 이 값을 권장합니다.
- **`warn`**: `type`이 없으면 기본값 `episodic`을 쓰고 경고를 남깁니다. 기존 클라이언트를 점검하는 과도기에 씁니다.
- **`deprecate`**: `warn`과 같되, 경고 문구에 이 가이드 링크가 포함됩니다.

운영 환경에서는 보통 `warn` → `deprecate` → `error` 순으로 올리며 클라이언트를 정리합니다.

## 권장 마이그레이션

모든 `recall` 호출에 검색 대상 타입을 명시합니다. 한 타입만 필요하면 `type` 하나로 충분하고, 여러 타입을 동시에 보려면 `memory_types` 배열을 씁니다. `memory_types`만으로도 의도가 드러나면 일부 경고는 생략될 수 있으나, 가능하면 **`type`도 함께 지정**해 의도를 분명히 하는 편이 좋습니다.

## 관련 문서

- [Core Deprecated API Inventory](../../architecture/core-deprecated-inventory.md) — `type` 파라미터 롤아웃 이력
