# Quickstart: Codex Adapter

## Dry Run

```bash
memento connect codex --dry-run
```

출력에서 확인할 항목:

- Codex version과 hooks feature stage/enabled
- 대상 `hooks.json`
- 추가될 lifecycle event
- backup 예정 경로
- trust 승인이 필요할 수 있다는 안내

## Connect

```bash
memento connect codex
```

기존 파일이 변경되는 경우에만 backup을 만들고 Memento handler를 추가한다. 같은 명령을
다시 실행하면 `changed: false`여야 한다.

## Fixture Replay

```bash
npm test -w @memento/agent-integration -- codex
```

검증 lifecycle:

1. SessionStart
2. UserPromptSubmit
3. PostToolUse
4. PreCompact
5. Stop

## Manual Hook Smoke

```bash
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"smoke","transcript_path":null,"cwd":"'"$PWD"'","model":"gpt-5.5","permission_mode":"default","source":"startup"}' \
  | memento hook codex
```

Memento server가 없거나 인증이 실패해도 exit code는 0이어야 한다.

## Disconnect / Rollback

이 이슈는 자동 disconnect를 제공하지 않는다. connect 출력의 backup 경로를 사용해
수동 복원할 수 있으며, 복원 전 현재 `hooks.json`을 별도로 보존한다.

