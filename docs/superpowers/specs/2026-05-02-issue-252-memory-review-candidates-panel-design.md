# 설계: 이슈 #252 — 대시보드 리뷰 후보 패널 골격 및 목록 조회

**상태**: 구현 전 검토용  
**날짜**: 2026-05-02  
**이슈**: [GitHub #252](https://github.com/jee1/memento/issues/252)  
**상위**: [#245](https://github.com/jee1/memento/issues/245)  
**선행**: [#243](https://github.com/jee1/memento/issues/243) — `GET /admin/memory/review-candidates` 등 Admin API가 `main`에 반영된 뒤 구현한다.

---

## 1. 목표·비목표

**목표**

- 대시보드에 **리뷰 후보 전용 패널(탭)** 을 두고, 브라우저 세션 기준으로 **대기(pending) 후보 목록**을 조회·표시한다.
- **로딩·빈 목록·HTTP 오류** 상태를 구분해 표시한다.
- 스타일은 **`static/css/tokens.css`** 및 기존 대시보드 컴포넌트(`components.css`, `dashboard.css`) 패턴을 우선한다.

**비목표 (#252 밖)**

- 메모리 본문 프리뷰 → [#253](https://github.com/jee1/memento/issues/253)
- `review` / `dismiss` POST 버튼 → [#254](https://github.com/jee1/memento/issues/254)
- SSE / WebSocket / 브라우저 푸시 → [#255](https://github.com/jee1/memento/issues/255)
- **`status` 전환 UI**(드롭다운 등) — 본 이슈에 포함하지 않는다. 전체 상태 목록이 필요하면 **후속 이슈**에서 `?status` 생략 또는 필터 UX를 다룬다.

---

## 2. 완료 조건과 API 규약 (#243 정합)

| #252 완료 조건 | 설계 대응 |
|----------------|-----------|
| pending(또는 전체) 후보를 패널에서 목록으로 볼 수 있다 | **v1 기본 요청은 항상 `GET /admin/memory/review-candidates?status=pending`** 로 통일한다. 이로써 “pending 후보 목록” 요구를 충족한다. “전체”는 이슈 문구상 대안일 뿐 필수가 아니며, 필요 시 후속 이슈에서 동일 엔드포인트에 쿼리 없음 또는 다른 `status` 값을 노출한다. |
| 토큰 기반 스타일·기존 대시보드와 시각적 일관성 | 신규 마크업은 **리터럴 색/간격 남발 대신 토큰·기존 유틸 클래스**를 사용한다. |

**에러 응답**

- `400`: 잘못된 `status` 쿼리 — 서버가 준 `error` 문자열을 **한 줄 요약**으로 표시(본문 전체 로깅·복붙 노출은 지양).
- `500`: 일반 오류 문구 + **수동 새로고침**으로 재시도 유도.

---

## 3. 변경 범위를 둘로 나눈 PR/커밋 서술 (blast radius 명시)

구현 시 논리적으로 두 덩어리로 설명·커밋 분리를 권장한다.

1. **(A) 탭 스크립트–마크업 정렬(회귀)**  
   - `static/dashboard.html`은 `m-tab-bar` / `m-tab-btn` 을 쓰는데, `static/js/dashboard-tabs.js`는 `.tab-bar` / `.tab-btn` 만 조회한다. **현재 조합으로는 탭 바인딩이 성립하지 않는다.**  
   - #252에서 네 번째 탭을 HTML에만 추가하면 기존 스크립트가 버튼을 잡지 못한다.  
   - 따라서 **선택자를 마크업과 일치시키는 수정**을 #252와 **같은 PR**에 포함하되, PR 본문·커밋 메시지에서 **「탭 기능 복구 + 리뷰 탭 추가」**로 이중 변경임을 명시한다.

2. **(B) 리뷰 후보 패널**  
   - 네 번째 탭 + 패널 마크업 + 전용 JS에서 `?status=pending` 목록 렌더 및 로딩/빈/오류 처리.

---

## 4. 접근안 요약·선택

| 안 | 요약 | 판단 |
|----|------|------|
| A | 신규 대시보드 탭 + 전용 JS, 탭 활성 시 1회 fetch | **채택** — 임베딩 탭과 유사한 lazy 초기화, #253·#254 확장에 유리 |
| B | Anchor 탭 내 사이드 패널 | 비채택 — 앵커 UI와 경쟁·모바일 부담 |
| C | 별도 정적 HTML | 비채택 — 세션·스크립트 중복, “대시보드 패널”과 어긋남 |

---

## 5. 아키텍처·데이터 흐름

- 클라이언트는 **`mementoAdminFetch`**(`static/js/memento-admin-fetch.js`)로만 Admin 경로를 호출한다.
- 경로: **`/admin/memory/review-candidates?status=pending`**
- 응답: 서버가 반환하는 JSON 중 **`candidates`** 배열을 렌더한다. (필드명·래핑은 #243 구현과 동일하게 맞춘다.)
- 탭 **최초 활성화 시** 목록을 로드한다(필요 시 idempotent한 `initReviewCandidatesPanel` 패턴 — `embedding-map`의 지연 초기화와 동일 계열).
- **수동 새로고침** 버튼: 이슈 본문에 없으나 운영자가 빈 화면·오류 후 재시도할 수 있게 **최소 UX로 포함**해도 #252 범위에 속한다(필수는 아니나 권장).

---

## 6. 목록에 표시할 컬럼 (`MemoryReviewCandidateRow` 정합)

서버 목록은 **`memory_item.content` 를 포함하지 않는다**(#243). UI 표시 컬럼은 아래 **큐 테이블 JSON 필드**에 한정한다(`packages/memento-core`의 `MemoryReviewCandidateRow`와 동일 스펠링).

| 필드 | 표시 |
|------|------|
| `id` | 후보 ID(짧게 truncate 가능; 복사는 #252 비필수) |
| `memory_id` | 링크는 #252 비범위(클릭 동작 없이 텍스트만 가능) |
| `status` | pending 고정 요청이어도 행에 표시해 두면 이후 전체 보기 확장 시 일관 |
| `priority` | 숫자 |
| `reason` | 긴 문자열은 **줄 수/글자 상한**으로 잘라 표시(겹침 방지) |
| `due_at` | ISO 또는 로컬 포맷 |
| `created_at`, `updated_at` | 선택: 좁은 화면에서는 숨김 가능 |
| `reviewed_at`, `dismissed_at` | pending-only 요청이면 대개 null — 생략 가능 |
| `metadata_json` | **v1에서는 표에서 생략**하거나 1줄 truncate(파싱·예쁜 출력은 후속) |

스키마 변경 시 이 표를 **설계 문서와 함께** 갱신한다.

---

## 7. UI·접근성

- `dashboard.html`의 기존 탭과 동일하게 **`role="tablist"` / `role="tab"` / `role="tabpanel"`**, `aria-selected`, `aria-controls`, `aria-hidden` 을 맞춘다.
- `dashboard-tabs.js`의 **`activateTab`** 에 `review`(또는 합의한 `data-tab` 값) 분기를 추가하고, 새 패널의 표시/숨김을 기존 세 탭과 동일 규칙으로 처리한다.
- 키보드: 기존 roving tabindex·Enter/Space 활성화 패턴을 **동일 선택자**로 유지한다.

---

## 8. 오류·보안 UX

- `mementoAdminFetch`가 재인증 플로우를 트리거할 수 있음 — **기존 대시보드와 동일**하게 둔다.
- 사용자에게 노출하는 메시지는 **요약 수준**; 스택 트레이스·내부 DB 메시지 원문 전체는 노출하지 않는다.

---

## 9. 테스트

- **최소 자동**: 탭 마크업에 네 번째 탭·패널 존재, 또는 `dashboard-auth-assets.spec` 등 기존 하네스 패턴에 맞는 스모크(프로젝트 관례 따름).
- **수동**: 세션 로그인 → 리뷰 탭 → pending 빈 목록 / 배치 후 행 표시 → 새로고침 → 앵커·임베딩·그래프 탭 전환 회귀.

---

## 10. 구현 후(graphify)

저장소 규칙에 따라 코드 변경 후 `graphify` 코드 그래프 재빌드를 실행한다.

---

## 11. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-02 | 초안: #252 범위, 서브에이전트 검토 반영(`status` 규약, PR 이중 서술, 컬럼 명시, 필터 UI 비포함) |
