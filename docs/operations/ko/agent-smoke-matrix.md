# Agent Integration Smoke Matrix

이 문서는 Codex CLI와 Claude Code adapter의 설치, lifecycle capture, 장애 fallback,
운영 CLI 호환성을 재현 가능하게 검증하는 절차를 정의한다.

## 기본 실행

```bash
npm run quality:agent-smoke -- \
  --output test-results/agent-smoke-matrix.json
```

기본 실행은 다음 항목을 검증한다.

- 설치된 `codex --version`, `codex features list`, `claude --version`,
  `claude --help`를 사용한 버전 및 hook capability 확인
- 임시 설정 파일에 `memento connect codex`, `memento connect claude-code`와
  동일한 public command 함수를 적용
- 기존 설정 보존, 원본 byte backup, lifecycle hook 5개, reconnect idempotency
- SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop fixture를 실제
  adapter runtime과 transport에 통과시켜 normalized event 전달 확인
- server down, auth failure, timeout에서 hook exit code 0과 제한 시간 내 반환 확인
- `doctor`, `status`, `demo`의 human 및 JSON 출력을 독립된 deterministic server
  double로 검증

결과는 `schema_version: 1` JSON이다. 외부 서버나 agent credential이 없는 항목은
실패로 위장하지 않고 `status: "skip"`과 안정적인 `reason_code`로 기록한다.

## 실제 독립 서버

독립 서버가 준비된 환경에서는 다음 변수를 지정한다.

```bash
MEMENTO_SMOKE_ENDPOINT=http://127.0.0.1:9001 \
MEMENTO_SMOKE_API_KEY=... \
npm run quality:agent-smoke
```

이 경우 `doctor`, `status`, `demo`를 human/JSON 모드로 각각 실행한다. `doctor`와
`demo`는 synthetic session을 생성한 뒤 정리하므로 운영 데이터베이스가 아닌 검증
전용 서버를 사용한다.

실제 서버가 없으면 `LIVE_SERVER_NOT_CONFIGURED`로 skip된다. 실제 서버 검증을 출시
필수 조건으로 강제하려면 `--require-live`를 추가한다.

## 실제 Agent Session

설치된 CLI의 버전과 hook capability는 기본 실행에서 자동 검증된다. 실제 prompt
실행은 agent 인증, 외부 API 사용량, 모델 가용성에 영향을 받으므로 CI에서 자동으로
실행하지 않는다.

릴리스 검증 환경에서는 다음 절차를 사용한다.

1. 검증 전용 Memento 서버를 실행하고 `MEMENTO_SMOKE_ENDPOINT`를 설정한다.
2. 임시 HOME에서 `memento connect codex`와 `memento connect claude-code`를 실행한다.
3. Codex를 시작해 `/hooks`를 열고 Memento handler 5개를 신뢰 처리한다. 설치 직후에는
   hook이 발견돼도 trust review 전까지 `0 active` 상태이므로 이 단계를 생략하면 안 된다.
4. 각 agent에서 prompt 1회와 tool call 1회를 수행하고 compact 및 정상 stop을 만든다.
5. `memento status --json`과 session export에서 lifecycle 5종이 수동 `remember`
   없이 저장됐는지 확인한다.
6. 실제 agent 실행과 server export 검증을 수행하는 controlled runner의 argv를 JSON
   배열로 `MEMENTO_SMOKE_CODEX_COMMAND`, `MEMENTO_SMOKE_CLAUDE_COMMAND`에 지정한다.

controlled runner는 마지막 stdout 줄에 다음 JSON evidence를 출력해야 한다.

```json
{
  "ok": true,
  "lifecycle_events": [
    "SessionStart",
    "UserPromptSubmit",
    "PostToolUse",
    "PreCompact",
    "Stop"
  ],
  "manual_remember": false
}
```

예:

```bash
MEMENTO_SMOKE_CODEX_COMMAND='["./scripts/live-codex-smoke.sh"]' \
MEMENTO_SMOKE_CLAUDE_COMMAND='["./scripts/live-claude-smoke.sh"]' \
npm run quality:agent-smoke -- --require-live
```

command 변수가 없으면 `LIVE_AGENT_COMMAND_NOT_CONFIGURED`로 skip한다. 잘못된 argv,
비정상 종료, lifecycle 누락, 수동 `remember` 사용은 fail이다. 실제 prompt 실행을
credential과 사용량 승인이 없는 환경에서 임의로 수행하지 않는 것이 의도된 동작이다.

## Compatibility Matrix

`compatibility_matrix`의 각 행은 다음 evidence를 결합한다.

| 항목 | Evidence |
| --- | --- |
| OS/architecture | Node runtime |
| Node | `process.version` |
| Codex | `codex --version`, hooks feature |
| Claude Code | `claude --version`, hook help capability |
| Adapter | isolated connect, backup, reconnect, lifecycle |
| Server | `MEMENTO_SMOKE_SERVER_VERSION` 또는 저장소 baseline |

지원 조합은 모든 필수 항목이 `pass`여야 한다. 외부 의존성은 `constraints` 배열의
reason code와 조치 문구로 추적한다.

## 실패 진단

- `CLI_NOT_INSTALLED`: 해당 CLI를 설치하고 PATH를 확인한다.
- `HOOK_CAPABILITY_MISSING`: 지원 버전으로 맞추고 feature/help 출력을 확인한다.
- `Codex 0 active hooks`: Codex `/hooks`에서 Memento handler 5개를 신뢰 처리한다.
- `CONNECT_VALIDATION_FAILED`: backup 원문, hook count, reconnect 결과를 확인한다.
- `LIVE_SERVER_NOT_CONFIGURED`: 검증 전용 endpoint와 API key를 설정한다.
- `LIVE_OPERATIONS_FAILED`: `doctor --json`의 guidance와 server log를 확인한다.
- `LIVE_AGENT_COMMAND_NOT_CONFIGURED`: controlled live-agent 실행 evidence를 등록한다.
