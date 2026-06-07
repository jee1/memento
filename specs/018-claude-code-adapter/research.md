# Research: Claude Code Adapter

## 근거

- 로컬 버전: `claude --version` → `2.1.153 (Claude Code)`.
- 로컬 설정: `~/.claude/settings.json`은 top-level `hooks` 아래 event별 matcher group과 command handler 배열을 사용한다.
- Anthropic 공식 Claude Code hooks 문서(<https://code.claude.com/docs/en/hooks>)는 command hook이 stdin JSON을 받고 settings 파일의 기존 hook과 함께 구성됨을 정의한다.
- 로컬 `--help` capability는 hook event 포함 옵션을 노출한다.

## 결정

- adapter-specific 해석은 `packages/memento-agent-integration/src/claude-code`에 둔다.
- hook command는 Claude Code의 command handler 구조에 맞춰
  `{type:"command", command:"memento hook claude-code"}`로 관리한다.
- 설정 merge는 알 수 없는 필드를 그대로 복사하고 Memento handler identity만 비교한다.
- hook runner는 공통 `CaptureRuntime`을 사용하며 stdout context를 쓰지 않는다.
- 최소 검증 기준은 2.1.153으로 진단하되 mismatch는 설치를 파괴하지 않고 warning으로 반환한다.

## 위험

- Claude Code minor release에서 payload 확장 필드가 추가될 수 있으므로 unknown field는 extensions 또는 무시로 처리한다.
- 실제 hook smoke는 사용자 홈을 수정하지 않고 fixture replay로 제한한다.
