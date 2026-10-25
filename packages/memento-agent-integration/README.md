# @memento/agent-integration

에이전트 lifecycle hook을 위한 공통 capture runtime이다.

- v1 envelope 검증과 정규화
- 저장·로그·telemetry 이전 fail-closed redaction
- event 32KiB, batch 50건/512KiB 제한
- 종료·실패 이벤트 우선 bounded queue
- 최대 2회 transient retry와 1~5000ms timeout
- hook 경로에 예외를 전파하지 않는 capture result

`capture()`는 로컬 처리와 enqueue만 수행한다. 네트워크 전송은 `drain()`으로 분리되어
에이전트 hook 반환을 차단하지 않는다.

## Codex

Codex CLI 0.137.0의 SessionStart, UserPromptSubmit, PostToolUse, PreCompact,
Stop command hook payload를 공통 envelope로 변환한다.

`memento connect codex`는 기존 `~/.codex/hooks.json`의 알 수 없는 필드와 trust state를
보존하며 handler를 idempotent하게 추가한다. 변경 시 원본 backup을 만든 뒤 temp file
rename으로 교체한다. `memento hook codex`는 stdin payload를 처리하고 서버 장애나
잘못된 입력에서도 Codex lifecycle을 막지 않도록 exit code 0을 반환한다.

## Claude Code

Claude Code 2.1.153의 SessionStart, UserPromptSubmit, PostToolUse, PreCompact,
Stop command hook payload를 공통 envelope로 변환한다.

`memento connect claude-code`는 기존 `~/.claude/settings.json`을 보존하며 handler를
idempotent하게 추가한다. 변경 시 원본 backup을 만든 뒤 temp file rename으로 교체한다.
`memento hook claude-code`는 stdin payload를 처리하고 서버 장애나 잘못된 입력에서도
Claude Code lifecycle을 막지 않도록 exit code 0을 반환한다.

### Case 지침 주입 (UserPromptSubmit)

`case` 태그 기억을 프롬프트마다 recall해 `additionalContext`로 붙인다. 기본은 꺼짐이다.
`~/.claude/settings.json`의 `env` 블록에 아래 값을 둔다. hook 프로세스가 이 환경 변수를 읽는다.

```json
{
  "env": {
    "MEMENTO_DIRECTIVES": "1",
    "MEMENTO_DIRECTIVES_MODE": "shadow"
  }
}
```

| 변수 | 뜻 |
|------|----|
| `MEMENTO_DIRECTIVES` | `1`/`true`일 때만 켠다 |
| `MEMENTO_DIRECTIVES_MODE` | `shadow`(기본, 로그만 남기고 주입 안 함) 또는 `live` |
| `MEMENTO_DIRECTIVES_PINNED_FILE` | 매번 앞에 붙일 고정 지침 파일(1KB 이하) |
| `MEMENTO_DIRECTIVES_LOG_DIR` | 주입 로그 폴더. 기본 `~/.claude/state/directive-log` |

먼저 `shadow`로 로그를 보고 `live`로 올린다. 설치된 `memento` 바이너리가 있어야 한다. `npx`는
기동이 느려 3.5초 마감을 넘기기 쉽다. 한 세션에서 같은 case는 한 번만 주입하고,
PreCompact에서 초기화한다. 서버 장애나 마감 초과는 빈 출력과 fallback 로그 한 줄로 끝난다.
