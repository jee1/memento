# Research: Codex Lifecycle Adapter

## Evidence Baseline

검증일은 2026-06-07이며 구현 기준은 로컬 설치본 `codex-cli 0.137.0`이다.

### Local Evidence

- `codex --version`: `codex-cli 0.137.0`
- `codex features list`: `hooks stable true`
- 실제 `~/.codex/hooks.json`:
  - event 배열: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`,
    `PostCompact`, `Stop`
  - group: `{ matcher?, hooks: [...] }`
  - command handler: `{ type: "command", command, timeout? }`
  - 기존 `state` trust hash가 최상위에 존재하므로 merge 시 보존해야 한다.
- 설치 바이너리 `strings`:
  - `HookEventsToml`
  - `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`,
    `UserPromptSubmit`, `SubagentStop`, `Stop`

### Official OpenAI Source

기준 tag: `openai/codex` `rust-v0.137.0`.

- `codex-rs/config/src/hook_config.rs`
  - `HookEventsToml`은 `PreToolUse`, `PermissionRequest`, `PostToolUse`,
    `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`,
    `SubagentStart`, `SubagentStop`, `Stop`을 선언한다.
  - `MatcherGroup`은 optional matcher와 handler 배열을 가진다.
  - command handler는 `command`, optional `commandWindows`, `timeout`, `async`,
    `statusMessage`를 가진다.
- `codex-rs/hooks/src/engine/discovery.rs`
  - config layer의 `hooks.json`을 읽고 기존 event group을 순서대로 discover한다.
  - user hook은 trust state에 따라 실행 여부가 달라진다.
- generated command input schema:
  - `session-start.command.input.schema.json`
  - `user-prompt-submit.command.input.schema.json`
  - `post-tool-use.command.input.schema.json`
  - `pre-compact.command.input.schema.json`
  - `stop.command.input.schema.json`

공식 source URL:

- https://github.com/openai/codex/blob/rust-v0.137.0/codex-rs/config/src/hook_config.rs
- https://github.com/openai/codex/tree/rust-v0.137.0/codex-rs/hooks/schema/generated
- https://github.com/openai/codex/blob/rust-v0.137.0/codex-rs/hooks/src/engine/discovery.rs

## Version / Capability Matrix

| Capability | 0.137.0 source | Local feature/config | Memento #459 |
| --- | --- | --- | --- |
| hooks feature | declared | `stable`, enabled | required |
| SessionStart | supported | configured | capture |
| UserPromptSubmit | supported | configured | capture |
| PostToolUse | supported | configured | capture |
| PreCompact | supported | configured | capture |
| Stop | supported | configured | capture |
| PostCompact | supported | configured | preserve only |
| PreToolUse | supported | configured locally | preserve only |
| PermissionRequest | supported | not configured | preserve only |
| SubagentStart/Stop | supported | binary strings/source | preserve only |

`PostToolUse`는 upstream issue에서 execution mode/tool별 coverage 차이가 보고된 적이 있다.
따라서 matrix의 "supported"는 schema와 dispatcher capability를 뜻하며 모든 Codex 실행
형태에서 완전한 event delivery를 보장하지 않는다. smoke 결과와 진단에 이 차이를
남긴다.

## Payload Mapping

| Codex event | Required source fields | Common event | Mapping |
| --- | --- | --- | --- |
| SessionStart | session_id, cwd, model, permission_mode, source | SESSION_START | client/model/cwd/extensions |
| UserPromptSubmit | session_id, turn_id, cwd, prompt | USER_PROMPT | content, text format, extensions |
| PostToolUse | session_id, turn_id, tool_use_id, tool_name, input/response | TOOL_RESULT | tool/outcome/input/output |
| PreCompact | session_id, turn_id, cwd, trigger | PRE_COMPACT | deterministic summary, budget, extensions |
| Stop | session_id, turn_id, last_assistant_message, stop_hook_active | STOP | completed outcome, summary, extensions |

공통 timestamp는 Codex payload에 없으므로 runner clock을 사용한다. event ID는 source
payload의 stable identity fields를 canonical JSON으로 hash한다. sequence는 hook process
간 공유 상태 없이 정렬 가능하도록 clock milliseconds를 사용하며, server의 late-arrival
계약이 동률/역전을 허용한다.

## Scope Decision

1. `session_id`: Codex `session_id`.
2. `process_id`: `MEMENTO_PROCESS_ID` override, 아니면 `agent_id`, `turn_id`,
   마지막으로 current process ID.
3. `project_id`: `MEMENTO_PROJECT_ID` override, 아니면 cwd에서 발견한 git root의
   normalized path, git root가 없으면 normalized cwd.
4. `owner_id`: `MEMENTO_OWNER_ID`가 있을 때만 설정한다.

project path는 Memento 저장 전 redaction/size pipeline을 거친다. 별도 git command를
spawn하지 않고 `.git` ancestor 탐색만 사용한다.

## Configuration Decision

- JSON을 `Record<string, unknown>`으로 읽어 알 수 없는 필드를 보존한다.
- 지원 lifecycle마다 matcher 없는 group 하나에 `memento hook codex` command handler를
  추가한다.
- 기존 어느 group에든 동일 command handler가 있으면 추가하지 않는다.
- 변경 전 원문 bytes를 timestamp `.bak`에 저장한다.
- temp file write 후 rename으로 config 교체를 원자화한다.
- no-op reconnect는 write와 backup을 모두 생략한다.
- diff는 event별 `add/preserve/noop` summary이며 secret/config content를 출력하지 않는다.

## Runner Decision

- adapter normalizer와 config planner는 `@memento/agent-integration`에 둔다.
- executable CLI routing과 server discovery/API transport는 `memento-server`에 둔다.
- runner는 모든 오류를 결과로 흡수하고 exit code 0을 반환한다.
- hook stdout은 비워 Codex control protocol에 영향을 주지 않는다.
- API key는 기존 `ADMIN_API_KEY`/`MEMENTO_API_KEY` 환경 경계를 재사용한다.
- server가 없거나 capability가 맞지 않으면 event를 잃을 수 있지만 Codex는 계속된다.

