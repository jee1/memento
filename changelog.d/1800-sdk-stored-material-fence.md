Changed
- `@jee1/memento-client` 0.1.4 의 `ContextInjector` 와 `@jee1/memento-assistant` 0.1.4 의 `beforeUserTurn` 이 서버와 같은 `<memento-material-…>` 저장 자료 경계로 기억을 감싼다. assistant 의 `systemContext` 는 고정 `<memento>` 태그를 더 쓰지 않는다. client 는 `fenceStoredMaterial` 을 내보낸다 (#1800)
