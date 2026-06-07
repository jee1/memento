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

## Claude Code

Claude Code 2.1.153의 SessionStart, UserPromptSubmit, PostToolUse, PreCompact,
Stop command hook payload를 공통 envelope로 변환한다.

`memento connect claude-code`는 기존 `~/.claude/settings.json`을 보존하며 handler를
idempotent하게 추가한다. 변경 시 원본 backup을 만든 뒤 temp file rename으로 교체한다.
`memento hook claude-code`는 stdin payload를 처리하고 서버 장애나 잘못된 입력에서도
Claude Code lifecycle을 막지 않도록 exit code 0을 반환한다.
