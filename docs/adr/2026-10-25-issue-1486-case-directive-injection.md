# ADR: case 지침 주입을 hook 쪽에서 선택한다 (이슈 #1486)

- 상태: Accepted
- 날짜: 2026-10-25
- 이슈: https://github.com/jee1/memento/issues/1486
- 관련: #1343(원격 MCP 인증), `packages/memento-agent-integration/README.md`

## Context

에이전트가 `case` 태그 기억을 스스로 recall하지 않으면 행동 지침이 쓰이지 않는다. UserPromptSubmit 마다 관련 case 를 컨텍스트에 붙이되, 같은 case 를 세션에서 반복하지 않고, 서버가 느리거나 없어도 프롬프트를 막지 않아야 한다.

## Decision

선택, 중복 제거, 로깅을 모두 `memento hook claude-code` 프로세스 안에서 한다.

- 상태는 append-only jsonl 로그 하나다. 세션 안 중복 제거는 로그를 접어(어제와 오늘 파일) 계산한다. reset 줄(PreCompact)은 집합을 비운다.
- 정책 상수는 `DIRECTIVE_POLICY` 한 곳에 둔다(case 300자, 최대 5건, 본문 4500바이트, 고정 지침 1KB, recall 1.5초, 마감 3.5초).
- `runDirectives` 는 reject 하지 않는다. 마감 타이머와 작업 경로는 먼저 잡은 쪽만 로그를 쓴다. 불변식은 로그 줄을 쓴 뒤에만 stdout 을 돌려주고, 쓰기에 실패하면 빈 문자열이다.
- 설정은 환경 변수만 쓴다(`MEMENTO_DIRECTIVES*`). 사용자는 Claude Code `settings.json` 의 `env` 블록에 둔다. 기본은 꺼짐이고 켜면 `shadow` 다.
- recall 은 `/mcp` 에 JSON-RPC `tools/call` 을 한 번 보낸다(initialize 없음, `Authorization: Bearer`). `/tools/recall` 은 owner 범위가 strict 일 때 `X-Memento-Agent-Id` 나 `owner_id` 를 요구해 hook 이 쓸 수 없었다. 호출은 엔진이 넘긴 `AbortSignal` 을 따르고 `127.0.0.1` 로 고정한다.

## 대안

- **서버 쪽 트리거.** 서버가 UserPromptSubmit 응답에 지침을 실어 보낸다. 선택 로직이 서버와 hook 으로 갈리고, 고정 지침 파일과 로그가 호스트에만 있어 Docker 서버에서는 보이지 않는다. 전송 계약도 넓어진다. 기각.
- **설정 파일(`~/.memento/directives.json`).** env 로 충분하고 설정 경로가 둘이 된다. 기각.
- **상태 파일이나 캐시.** 로그와 이중 기록이 되어 어긋난다. 로그를 접는 쪽이 단일 진실이다.
- **Codex 와 hook 경로 분리.** 파싱이 두 번 일어나고 Codex 호출부 위험이 생긴다. 공유 `runAgentHookCommand` 에 선택적 `directives` 옵션만 더했다. Codex 러너는 무시한다.

## Consequences

- `ClaudeHookRunResult.stdout` 이 `''` 리터럴에서 `string` 으로 넓어진다.
- hook 프로세스가 `memento` 바이너리로 설치돼 있어야 3.5초 마감 안에 시작한다. `npx` 는 맞지 않는다.
- `/mcp` 라우트 rate limit 에 프롬프트마다 recall 1회가 쓰인다.
- 프로젝트 범위 헤더가 없어 case 는 사용자 전역이다.
- `/clear` 가 session_id 를 유지하는지는 확인 전이다. 유지하면 SessionStart `source=clear` 에서 reset 을 더한다.
