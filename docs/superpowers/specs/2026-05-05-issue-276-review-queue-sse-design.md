# 설계: 이슈 #276 — Admin 리뷰 후보 SSE + 폴링 폴백

**상태**: 구현 반영  
**날짜**: 2026-05-05  
**이슈**: GitHub #276  
**선행**: [#255 폴링 설계](./2026-05-03-issue-255-review-notify-polling-design.md)

## 목표

- Review Queue pending 목록이 **실시간에 가깝게** 갱신되도록 **SSE**를 제공한다.
- **Admin 브라우저 세션**(`memento_admin_session`)은 기존 `GET /admin/memory/review-candidates`와 **동일 경로·동일 미들웨어**로 적용한다.
- `EventSource` 실패·오류 시 **#255 폴링**으로 안전하게 폴백한다.
- **1차 파동**: Redis·외부 브로커 없이 **프로세스 내** `Set<Response>` 팬아웃만 사용한다.

## 비목표

- nginx 등 **리버스 프록시 전제** 문서화(사용자 확인: 직접 바인딩 위주).
- 기존 **루트 WebSocket**에 리뷰 채널을 합치지 않는다(세션 모델 불일치).
- 멀티 레플리카 간 이벤트 전파.

## 서버

- `GET /admin/memory/review-candidates/stream` — `text/event-stream`, `retry:`, `event: ready`, `: ping`, `event: changed` + `data: {"reason":...}`.
- `notifyReviewCandidatesChanged` 호출: `POST .../review`·`.../dismiss` 성공 시, `POST /admin/batch/run`의 `memory_review_candidates` 완료 시.

## 클라이언트

- 초기 목록 로드 성공 후 `EventSource(STREAM_URL)`; `open` 시 폴링 타이머 정지.
- `changed` 수신 시 `GET` 목록으로 동기화(Review 탭 활성 시 표 갱신, 비활성 시 뱃지·토스트 규칙 유지).
- `onerror` → 스트림 종료 후 `startPollingIfNeeded()`.
- `beforeunload`에서 스트림 정리.

## 리스크·한계

- **단일 노드**에서만 모든 대시보드 클라이언트에 푸시가 도달한다.
- 장기 SSE가 세션 `touch`를 유발할 수 있으나, 운영자 수·단일 노드 MVP에서는 허용 범위로 둔다.
