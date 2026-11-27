Fixed
- 서버 안내문(stdio)이 기본 도구 목록에 없는 `search_local`, `anchors` 를 적지 않는다 (#1849)
- HTTP `/mcp` 의 `prompts/get` 이 MCP 사양대로 `messages` 를 돌려준다. 없는 프롬프트 이름의 오류 코드는 `-32602` 다. `prompts/call` 은 그대로 동작한다 (#1849)
- 플러그인 스킬 `memento-memory-loop` 의 보존 기간 표기를 코드 값(30일, 180일, 90일 미사용)으로 고친다 (#1849)
