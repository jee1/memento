# 설계: 이슈 #255 — 리뷰 후보 알림 UX 스파이크 (폴링·Notification·SSE 검토)

**상태**: 구현 포함(B안)  
**날짜**: 2026-05-03  
**이슈**: [GitHub #255](https://github.com/jee1/memento/issues/255)  
**상위**: [#245](https://github.com/jee1/memento/issues/245) · [#18 분해](https://github.com/jee1/memento/issues/18)

---

## 1. 목표·비목표

**목표**

- 주기적 **폴링** vs **`Notification` API** vs **SSE/WebSocket**을 운영·보안(Admin 세션)·구현 비용 관점에서 비교하고 **추천안과 근거**를 문서화한다.
- **최소 구현**으로 대시보드 **Review Queue** 흐름에 맞춰, 기존 `GET /admin/memory/review-candidates?status=pending`만 사용하는 **백그라운드 폴링**과 **뱃지·토스트**로 “대기열이 늘어났다”는 신호를 준다.

**비목표 (#255)**

- Redis·외부 큐·MCP 노출.
- 전용 “카운트만” Admin API 추가(첫 파동에서는 기존 목록 API 재사용).
- 브라우저 시스템 알림(`Notification`) 또는 SSE/WebSocket **본 구현**(문서에서만 후순위로 명시).

---

## 2. 옵션 비교 (요약)

| 방식 | 운영 | 보안(Admin) | 구현 | 판단 |
|------|------|---------------|------|------|
| **폴링** | 주기적 GET 부하(간격으로 조절) | **동일 출처·기존 쿠키/헤더**만 사용, 새 장기 연결 없음 | 클라이언트만 또는 소규모 | **1차 채택** |
| **`Notification` API** | OS 권한·사용자 피로 | 탭이 백그라운드일 때 “주의 환기”에는 유리하나, **데이터는 여전히 폴링/SSE 필요** | 권한 UX·정책 추가 | **선택 옵션**(후속) |
| **SSE / WebSocket** | 프록시 타임아웃·연결 수·재연결 | 장기 연결·인증 유지 설계 필요 | 서버·클라 모두 확대 | **후속**(대량·초단 지연 필요 시) |

**추천**: Admin 대시보드는 **로그인 세션 기반·소수 운영자** 전제이므로, **60초 간격 폴링 + pending 개수 증가 감지 + 탭 뱃지·토스트**로 #255를 닫는다. Anchor Map의 **WebSocket 시도 후 폴링 폴백**과 같은 철학(실시간은 필요 시 확장)과 정합한다.

---

## 3. 최소 구현 (채택안)

**동작**

1. Review 탭에서 목록을 **최초 로드**한 뒤, **성공 시에만** 백그라운드 폴링을 시작한다.
2. `document.visibilityState === 'visible'`일 때만 주기적 요청(백그라운드 탭에서 불필요한 부하 감소).
3. `visibilitychange`로 탭이 다시 보이면 **즉시 1회** 폴링(최신 상태 동기화).
4. 이전에 확보한 **pending 건수**보다 증가하면:
   - **토스트**(`role="status"`, `aria-live="polite"`)로 증가분 안내, 수 초 후 자동 숨김.
   - **Review Queue 탭**에 현재 pending **건수 뱃지**(99+ 캡).
5. 사용자가 Review 탭을 열 때마다(`initReviewCandidatesPanel`) **뱃지 제거** 후 **목록을 다시 로드**해 다른 탭에 있을 때 쌓인 변경을 반영한다.
6. 사용자가 Review 탭을 보고 있는 동안 대기열이 늘면 **목록을 같은 응답으로 갱신**(추가 `GET` 없이 방금 받은 JSON으로 `apply`).

**상수**

- 기본 폴링 간격은 **60초**(클라이언트 폴백 및 서버 미주입 시). 운영 조정은 **#274**: `MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS`, `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS`(선택) 및 `docs/api/*/api-reference.md` 참고.

**제한**

- “개수만 같고 행이 바뀐” 경우는 감지하지 않음(최소 구현). 후속에서 ETag·`updated_at` 커서 등으로 확장 가능.

---

## 4. 오류·보안

- 폴링 실패 시 **조용히 무시**(기존 목록·수동 Refresh 유지). 로그 스팸 방지.
- Admin 경로는 기존과 동일하게 **`mementoAdminFetch`/세션**을 따른다.
- 새 엔드포인트·CORS·장기 연결을 도입하지 않아 **공격면 증가가 최소**다.

---

## 5. 테스트·검증

- **자동**: 기존 대시보드 정적 번들에 대한 단위 테스트가 없다면 **수동 시나리오**로 검증한다.
- **수동 (`npm run dev:http` 등으로 대시보드 로드 후)**  
  1. 로그인 후 **Review Queue** 탭을 한 번 연다.  
  2. 다른 탭으로 전환한 뒤, 서버/배치로 pending 후보를 **추가**한다(또는 DB에서 큐 삽입).  
  3. 최대 ~1분 내 토스트·탭 뱃지가 나타나는지 확인한다.  
  4. Review 탭으로 돌아가면 뱃지가 사라지고 목록이 갱신되는지 확인한다.

---

## 6. 후속 이슈 후보

- 폴링 간격·백오프를 **설정화**.
- `Notification` API(권한 거부 시 그레이스풀).
- SSE(서버 푸시) + Admin 인증 스트림.

---

## 7. 변경 파일

| 파일 | 내용 |
|------|------|
| `static/js/review-candidates-panel.js` | 폴링, 토스트, 뱃지, `applyListSuccess` 분리 |
| `static/dashboard.html` | 탭 뱃지 `#rc-tab-badge`, 토스트 `#rc-toast` |
| `static/css/dashboard.css` | `.m-tab-badge`, `.rc-toast` (디자인 토큰 사용) |
