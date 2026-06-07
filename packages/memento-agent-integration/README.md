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
