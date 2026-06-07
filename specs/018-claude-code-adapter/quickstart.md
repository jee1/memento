# Quickstart: Claude Code Adapter

```bash
memento connect claude-code
```

명령은 변경 plan, backup 위치, 추가된 lifecycle event를 JSON으로 출력한다. 재실행 시 `changed=false`여야 한다.

hook entrypoint:

```bash
printf '%s' '{"hook_event_name":"SessionStart","session_id":"s","cwd":"/repo"}' \
  | memento hook claude-code
```

입력이나 Memento transport가 실패해도 hook 명령은 exit code 0을 반환한다.
