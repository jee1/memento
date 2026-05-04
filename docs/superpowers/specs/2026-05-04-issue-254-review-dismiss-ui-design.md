# 설계: 이슈 #254 — Review / Dismiss 버튼 및 목록 갱신 UX

**날짜**: 2026-05-04  
**이슈**: [GitHub #254](https://github.com/jee1/memento/issues/254)  
**상위**: [#245](https://github.com/jee1/memento/issues/245)  
**선행(권장)**: [#252](https://github.com/jee1/memento/issues/252), [#253](https://github.com/jee1/memento/issues/253)

---

## 1. 목표·비목표

**목표**

- `POST /admin/memory/review-candidates/:id/review`, `POST .../dismiss`를 대시보드에서 호출할 수 있다.
- 성공 시 **항상** `GET /admin/memory/review-candidates?status=pending`로 목록을 다시 불러와 표를 갱신한다(폴링·초기 로드와 동일 경로, 단일 정책).
- `400` / `404` / `409` / `500` 응답을 사용자에게 알린다(메시지는 서버 `error`·`code`를 우선).
- 동일 후보에 대한 **중복 제출 방지**: 요청 진행 중 버튼 비활성·`aria-busy` 등 접근 가능한 잠금.
- 스타일은 `static/css/tokens.css`·기존 `dashboard.css` 패턴을 따른다.

**비목표 (#254 밖)**

- 배치·선정 로직 변경, SSE/WebSocket.
- 관리자 API에 별도 CSRF 토큰 필드 신설(현재 대시보드는 동일 출처 세션 쿠키 + `mementoAdminFetch`의 `credentials: 'same-origin'`).

---

## 2. 배치된 접근 방식 비교·선택

| 옵션 | 설명 | 장단 |
|------|------|------|
| A | **프리뷰 패널에만** Review / Dismiss | 맥락(본문 확인 후 조치)에 맞음. 잘못된 행 조작 위험 낮음. 행 선택 필수. |
| B | **테이블 행마다** 액션 컬럼 | 클릭 수 적음. 프리뷰 없이 조치 가능해 오조작·실수 가능성↑. |
| C | A+B 동시 | 중복 UI, 유지보수 비용↑(YAGNI). |

**채택: A** — 후보 행 선택 후 프리뷰 영역 하단(또는 메타 블록 아래)에 두 버튼을 둔다. `tr`에 `data-candidate-id`(UUID)를 심어 선택 시 프리뷰 로직이 동일 ID로 POST를 구성한다.

---

## 3. Admin API(기존 계약, UI가 맞출 것)

- **Review**: `POST /admin/memory/review-candidates/:id/review`, 본문 `{}` 또는 생략(JSON).
- **Dismiss**: `POST /admin/memory/review-candidates/:id/dismiss`.
- **성공 `200`**: `{ ok: true, candidate, timestamp }` (`candidate`는 전체 목록 스캔 결과일 수 있음 — UI는 **목록 재조회 결과**만 신뢰).
- **오류**: `MemoryReviewCandidateError` — `404` + `code: memory_review_candidate_not_found`, `409` + `code: memory_review_candidate_not_actionable`; `400` 잘못된 UUID; `500` 일반 실패.

클라이언트는 `mementoAdminFetch` + `method: 'POST'`, `headers: { Accept: 'application/json', 'Content-Type': 'application/json' }`, `body: '{}'`.

---

## 4. 클라이언트 동작(상세)

1. **행 렌더링**: 각 `tr`에 `data-candidate-id`(서버 `c.id`)를 설정한다. 기존 `data-memory-id` 등은 유지.
2. **버튼 가시성**: 행이 선택되어 프리뷰 디테일이 열린 경우에만 Review/Dismiss를 **활성**으로 둔다(선택 없음·placeholder 상태에서는 `disabled`).
3. **클릭 핸들러**:
   - 진행 중 플래그가 켜져 있으면 무시.
   - 플래그 ON → 두 버튼 `disabled` + `aria-busy="true"`(컨테이너에 위임 가능).
   - 해당 후보 ID로 위 POST URL 호출.
4. **성공**: 짧은 성공 피드백(기존 `#rc-toast` 재사용 가능, 3~5초 자동 숨김 정도) 후 **`loadList()`** 호출. `loadList`는 이미 `clearRowSelection`·`resetPreviewPanel`을 포함하므로 목록이 서버 상태와 일치한다.
5. **실패**:
   - `rc-error`에 사람이 읽을 메시지 표시(`body.error` 또는 상태코드 기본 문구). `409`/`404`는 “이미 처리됨·없음” 뉘앙스를 반영한 문구로 매핑 가능(서버 메시지 우선).
   - 토스트만으로 치명적 오류를 빠뜨리지 않도록, **최소한 `rc-error` 또는 프리뷰 인라인 한 곳은 항상 채운다**(이슈의 “토스트 또는 인라인” 중 **인라인 우선**: `rc-error`를 기본, 성공만 토스트).
6. **폴링과의 관계**: 재조회 후 `applyListSuccess`가 `lastPendingCount`를 갱신하므로 폴링 토스트 로직과 충돌하지 않는다.

---

## 5. HTML·CSS

- `static/dashboard.html`: 프리뷰 패널(`#rc-preview-detail` 내부)에 버튼 그룹 컨테이너 추가, 예: `div.rc-preview-actions` 안에 `button#rc-btn-review`, `button#rc-btn-dismiss`. `type="button"`.
- `static/css/dashboard.css`(또는 기존 review 후보 블록): 토큰 기반 간격·보조 버튼 스타일(`m-button--secondary` 등 기존 클래스 재사용).

---

## 6. 테스트

- **서버**: 기존 `admin.routes.spec.ts`의 POST 시나리오 유지.
- **대시보드 정적 검증**: `dashboard-review-candidates-panel.spec.ts`(또는 동일 패턴)에 다음을 문자열·구조로 검증:
  - `review-candidates-panel.js`에 `POST` 대상 경로 `/admin/memory/review-candidates/` 및 `review`·`dismiss` 세그먼트 포함.
  - `dashboard.html`에 액션 버튼 id 또는 `rc-preview-actions` 존재.

(브라우저 E2E는 비범위 unless CI에 도입됨.)

---

## 7. 완료 조건 (#254 정합)

- 대시보드에서 pending 후보를 선택한 뒤 Review 또는 Dismiss를 실행할 수 있다.
- 성공 후 **재조회된** pending 목록이 표시된다.
- `404`/`409` 등이 사용자에게 전달되고, 진행 중 중복 클릭이 막힌다.

---

## 8. 구현 후 graphify

코드 변경이 끝나면 저장소 규칙에 따라 `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` 실행.
