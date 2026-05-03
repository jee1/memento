# 설계: 이슈 #253 — 후보 행 상세·메모리 프리뷰

**날짜**: 2026-05-03  
**이슈**: [GitHub #253](https://github.com/jee1/memento/issues/253)  
**상위**: [#245](https://github.com/jee1/memento/issues/245)  
**선행**: [#252](https://github.com/jee1/memento/issues/252)

---

## 1. 목표·비목표

**목표**

- 리뷰 후보 **행 선택** 시 우측(넓은 화면) 또는 **표 아래(좁은 화면)** 고정 **프리뷰 패널**에 다음을 표시한다.
  - 큐 메타: `priority`, 전체 `reason`, `due_at`(로컬 가독 형식), `memory_id`
  - 기억 본문: `GET /admin/memory/items/:memory_id` 응답의 `memory.content` 및 동봉 메타 필드
- 목록 테이블의 `reason`은 **줄임(문자 상한 + CSS line-clamp)** 으로 겹침을 줄이고, 전문은 패널에서만 본다.
- 스타일은 `static/css/tokens.css`·기존 `dashboard.css` 패턴을 따른다.

**비목표 (#253 밖)**

- `review` / `dismiss` POST UI → [#254](https://github.com/jee1/memento/issues/254)
- 실시간 알림 → [#255](https://github.com/jee1/memento/issues/255)

---

## 2. Admin API: 단일 기억 프리뷰

- **경로**: `GET /admin/memory/items/:memory_id`
- **검증**: `:memory_id`는 `mem_[A-Za-z0-9_]{1,220}` (URL 디코드 후 검사). 불일치 시 `400`.
- **조회**: `memory_item`에서 본문·메타 일부를 SELECT. `is_deleted = 1` 또는 없으면 `404`.
- **로그**: `memory_id`만 기록, `content` 전문 미기록 (#243 정합).
- **구현 위치**: `@memento/core`의 `admin-memory-item-preview-service.ts` + `memento-server` `admin.routes.ts`.

---

## 3. 대시보드 UI

- **레이아웃**: `.review-candidates-body` 그리드 — `1fr | minmax(12rem, 28rem)`; `max-width: 56rem` 이하에서 **1열**(표 아래 패널).
- **상호작용**: `tbody` 위임으로 `tr` 클릭 또는 Enter/Space(포커스 가능 행). 선택 행 `rc-row--selected` + `aria-selected`.
- **클라이언트**: `mementoAdminFetch`로 목록·프리뷰 모두 호출. 프리뷰 URL은 `encodeURIComponent(memory_id)` 사용.
- **새로고침**: 목록 재로드 시 선택·프리뷰 초기화.

---

## 4. 완료 조건 (#253 정합)

- 행 선택 시 메모리 프리뷰(본문)가 표시된다.
- 모바일·데스크톱에서 텍스트 겹침 없이 표시된다(#245 AC) — `pre-wrap`, `word-break`, 패널 `max-height`+스크롤.

---

## 5. 테스트

- **core**: `parseAdminMemoryItemIdParam`, `getAdminMemoryItemPreviewById` 단위 테스트.
- **server**: `GET /admin/memory/items/…` 200/400/404.
- **dashboard**: HTML에 프리뷰 영역, JS에 `/admin/memory/items/` 포함 검증.
