# 기억 진화 데모 — 시드 데이터·운영 가이드

이 문서는 Memento **기억 진화 데모**(이슈 [#80](https://github.com/jee1/memento/issues/80))를 로컬에서 재현하고, 발표·소개 시 어떤 순서로 시연할지 정리합니다. 구현 이슈: [#340](https://github.com/jee1/memento/issues/340)(대시보드 셸), [#341](https://github.com/jee1/memento/issues/341)(스냅샷 API), [#342](https://github.com/jee1/memento/issues/342)(API 연동), [#344](https://github.com/jee1/memento/issues/344)(망각 정책), [#396](https://github.com/jee1/memento/issues/396)·[#397](https://github.com/jee1/memento/issues/397)(Episodic→Semantic), [#346](https://github.com/jee1/memento/issues/346)(본 문서).

---

## 목차

1. [개요](#개요)
2. [시드 데이터가 정의되는 방식](#시드-데이터가-정의되는-방식)
3. [로컬 실행](#로컬-실행)
4. [API로 검증하기](#api로-검증하기)
5. [발표·시연 흐름](#발표시연-흐름)
6. [픽스처·시나리오 확장](#픽스처시나리오-확장)
7. [향후 DB 시드 전환 절차](#향후-db-시드-전환-절차)
8. [문제 해결](#문제-해결)

---

## 개요

기억 진화 데모는 **실제 DB에 기억을 쌓지 않고**, 미리 정의된 **스냅샷(read model)** 으로 다음을 보여 줍니다.

| 시나리오 ID | 제목 (예) | 핵심 메시지 |
|-------------|-----------|-------------|
| `answer-over-time` | 시간 경과에 따른 답변 변화 | 같은 질문에 대한 답이 episodic → semantic 중심으로 **변형**됨 |
| `forgetting-policy` | 망각 정책 비교 | 중요도·핀·TTL에 따라 기억이 **망각·보존·승격**됨 |
| `episodic-to-semantic` | Episodic → Semantic 통합 | 여러 episodic 조각이 수면 통합 후 **하나의 semantic** 으로 응축됨 |

데이터는 `@memento/core`의 `evolution-demo` 도메인에 **인코드 픽스처**로 들어 있으며, HTTP admin API가 이를 그대로 노출합니다. 대시보드 **「기억 진화 데모」** 탭은 세션 없이도 열리지만, API 호출은 관리자 인증이 필요합니다.

---

## 시드 데이터가 정의되는 방식

### 디렉터리 구조

```text
packages/memento-core/src/domains/evolution-demo/
├── types.ts          # 스냅샷·시나리오 TypeScript 타입
├── spec.ts           # Zod 스키마·허용 scenario_id 목록
├── store.ts          # TS 픽스처 import·병합 (getFixtureSnapshot)
├── getters.ts        # SCENARIO_CATALOG + list/get 공개 API
├── index.ts          # 패키지 export
├── evolution-demo.spec.ts
└── fixtures/         # 런타임 TS 픽스처 (ESM import)
    ├── answer-over-time.snapshots.ts
    └── forgetting-policy.snapshots.ts
    # (선택) *.snapshots.json — 참고/원본 카피용. store.ts는 import하지 않음
```

`packages/memento-server`는 라우트만 담당합니다.

```text
packages/memento-server/src/server/routes/admin/admin-evolution-demo.routes.ts
```

### 계층 역할

| 파일 | 역할 |
|------|------|
| `fixtures/*.snapshots.ts` | 시나리오별 질문·시점(point)·답·`memory_summary`·`explanation`을 **export한 객체** (한국어 데모 문안은 [#394](https://github.com/jee1/memento/issues/394) 등). Node ESM에서 `import` 가능한 형태 |
| `store.ts` | TS 픽스처를 `buildSnapshotsFromFixture()`로 평탄화해 `EvolutionDemoSnapshot` 맵에 병합. `episodic-to-semantic`은 동일 파일에 `CONSOLIDATION_SNAPSHOTS` 인라인 정의. `memory_groups`, `episodic_sources`, `semantic_result` 등 선택 필드 지원 |
| `getters.ts` | **시나리오 카탈로그**(`SCENARIO_CATALOG`: id, title, points)와 스냅샷 조회. 카탈로그 라벨이 API 응답의 `point_label`에 반영됨 |
| `spec.ts` | `EvolutionDemoSnapshotSchema` 등으로 응답 형식 고정. `EVOLUTION_DEMO_SCENARIO_IDS`에 허용 ID 나열 |

### 스냅샷 한 건의 의미

각 스냅샷은 **특정 시나리오·특정 시점**에서 에이전트가 사용자 질문에 답한 결과를 나타냅니다.

- `question` / `answer` — 시연용 질문과 그 시점의 답변
- `memory_summary` — episodic·semantic·망각·보존 건수와 `summary_text`
- `explanation` — 내레이션(발표자가 읽을 설명)
- `timestamp` — 스토리 타임라인용 ISO 8601
- `memory_groups` (선택) — `forgetting-policy` 등에서 기억별 outcome (`forget` / `preserve` / `pin`)
- `episodic_sources`, `semantic_result`, `search_comparison` (선택) — `episodic-to-semantic` 통합 전후 비교

**중요:** 데모 데이터는 운영 DB의 `remember` 결과가 아닙니다. 발표 재현성을 위해 **고정 스냅샷**을 씁니다.

### TS 픽스처 형식 (예)

`fixtures/answer-over-time.snapshots.ts` (런타임 소스):

```typescript
export const answerOverTimeFixture = {
  scenario_id: 'answer-over-time',
  question: '관리자 API에는 어떤 인증 방식을 채택했나요?',
  snapshots: {
    early: {
      point_label: '초기 (1일차)',
      answer: '...',
      memory_summary: {
        episodic_count: 14,
        semantic_count: 0,
        forgotten_count: 0,
        preserved_count: 14,
        summary_text: '...',
      },
      explanation: '...',
      timestamp: '2026-01-21T10:00:00.000Z',
    },
    // mid, late ...
  },
} as const;
```

`store.ts`에서 `import { answerOverTimeFixture } from './fixtures/answer-over-time.snapshots.js'` 후 `buildSnapshotsFromFixture()`가 `scenario_id` + `point_id` 키로 평탄화합니다.

**JSON 파일(`*.snapshots.json`)** 이 저장소에 남아 있을 수 있으나, **런타임 경로는 사용하지 않습니다** (과거 카피·diff 참고용). 새 시나리오는 `.snapshots.ts`만 추가하세요.

---

## 로컬 실행

### 사전 조건

- Node.js ≥ 24, 저장소 루트에서 `npm install` 및 `npm run build` 완료
- `ADMIN_API_KEY` 설정 (`.env` 또는 셸). [환경 변수 거버넌스](../guides/ko/environment-variable-governance.md) 참고.

### 1. HTTP 관리 서버 기동

```bash
npm run dev:http
```

기본 URL은 환경에 따라 `http://localhost:9001` 또는 `http://localhost:8080`입니다 (`PORT` / `MCP_SERVER_PORT`). 터미널에 표시된 주소를 사용하세요.

### 2. 대시보드 열기

브라우저에서:

```text
http://localhost:<PORT>/dashboard
```

**기본 탭은 로그인 상태에 따라 다릅니다** ([#342](https://github.com/jee1/memento/issues/342) API 연동·`dashboard-auth.js`):

| 상태 | 처음 보이는 탭 | 이유 |
|------|----------------|------|
| **로그인됨** (`signed-in`) | **Anchor Map** | HTML 초기 `active` 탭이 anchor이며, 인증 성공 시 `maybeActivateTabForAuth`가 anchor로 전환 |
| **미로그인·세션 확인 중** (`signed-out` / `checking` 등) | **기억 진화 데모** | 세션 전용 탭(anchor 등)은 `session-only`로 숨기고, 데모 탭만 노출·활성화 |

데모 탭 패널은 미로그인에서도 열리지만, **시나리오·스냅샷 API 로드는 로그인 후**에만 동작합니다. 시나리오·시점을 선택하면 스냅샷 API에서 데이터를 불러옵니다.

### 3. 관리자 API 키로 로그인

1. 대시보드 상단 **로그인** / 인증 패널에서 `ADMIN_API_KEY` 값을 입력합니다.
2. 서버는 `POST /auth/session`으로 키를 검증하고 **HTTP-only 세션 쿠키**를 발급합니다. 키는 정적 JS에 노출되지 않습니다([보안](../reference/ko/security.md)).
3. 로그인 후 `mementoAdminFetch`가 `/admin/*` 요청에 세션을 붙입니다. 데모 탭의 시나리오 목록·스냅샷 로드가 동작해야 합니다.

### 4. 빠른 동작 확인 체크리스트

- [ ] `GET /admin/evolution-demo/scenarios` → 200, `scenarios` 배열 비어 있지 않음
- [ ] `GET /admin/evolution-demo/snapshots/answer-over-time/early` → 200, `answer`·`memory_summary` 존재
- [ ] 대시보드에서 시나리오 변경 시 질문·답·요약·설명이 갱신됨
- [ ] 잘못된 ID → 404

---

## API로 검증하기

모든 경로는 **`/admin` 접두사** 아래이며, 브라우저 세션 또는 동등한 인증이 필요합니다.

### 시나리오 목록

```http
GET /admin/evolution-demo/scenarios
```

**응답 예:**

```json
{
  "scenarios": [
    {
      "scenario_id": "answer-over-time",
      "title": "시간 경과에 따른 답변 변화",
      "points": [
        { "point_id": "early", "label": "초기 (1일차)" },
        { "point_id": "mid", "label": "중기 (30일차)" },
        { "point_id": "late", "label": "후기 (90일차)" }
      ]
    }
  ]
}
```

### 스냅샷 조회

```http
GET /admin/evolution-demo/snapshots/:scenario_id/:point_id
```

**예:**

```bash
curl -sS -b cookies.txt \
  "http://localhost:9001/admin/evolution-demo/snapshots/answer-over-time/mid"
```

**응답 필드 (공통):** `scenario_id`, `point_id`, `point_label`, `question`, `answer`, `memory_summary`, `explanation`, `timestamp`

**시나리오별 추가 필드:**

| 시나리오 | 추가 필드 |
|----------|-----------|
| `forgetting-policy` | `memory_groups[]` — `label`, `importance`, `status`, `outcome`, `pinned` |
| `episodic-to-semantic` | `episodic_sources[]`, `semantic_result`, `search_comparison` |

**오류:**

| 상태 | 의미 |
|------|------|
| 400 | `scenario_id` 또는 `point_id` 누락 |
| 404 | 카탈로그·픽스처에 없는 조합 |
| 401/403 | 세션 없음 또는 키 불일치 |

단위 테스트: `packages/memento-server/src/server/routes/admin/admin-evolution-demo.routes.spec.ts`

---

## 발표·시연 흐름

이슈 [#80](https://github.com/jee1/memento/issues/80) 코멘트 기준 **권장 시연 순서**:

1. **`answer-over-time`** — 시간에 따른 답변 변화
2. **`forgetting-policy`** — 망각 정책 비교
3. **`episodic-to-semantic`** — Episodic → Semantic 통합

스토리가 쌓이도록 **한 가지 질문 맥락(관리자 API 인증)** 을 유지한 채 진행하는 것이 좋습니다.

### 1단계: `answer-over-time`

**메시지:** 기억은 그대로 두는 것이 아니라 **변형**된다.

| 시점 (`point_id`) | 보여 줄 것 |
|-------------------|------------|
| `early` | 긴 답, episodic 다수, semantic 0 |
| `mid` | 답 축소, episodic 감소·semantic 증가 |
| `late` | 한두 문장 답, semantic 중심 |

### 2단계: `forgetting-policy`

**메시지:** 중요도·핀·TTL이 **누가 남고 누가 사라지는지**를 가른다.

| 시점 | 보여 줄 것 |
|------|------------|
| `day-30` | `memory_groups`: 저중요 `forget`, 고중요 `preserve`, 핀 `pin` |
| `day-90` | 저중요 hard delete, semantic·핀 유지 |

### 3단계: `episodic-to-semantic`

**메시지:** recall이 **여러 episodic 조각**을 돌려주던 것이, 통합 후 **하나의 semantic** 으로 바뀐다.

| 시점 (`point_id`) | 보여 줄 것 |
|-------------------|------------|
| `before` | `episodic_sources` 4건, 긴 답 |
| `after` | `semantic_result`, 통합된 답 |

### 발표 팁

- 시나리오 드롭다운 순서가 위와 다르면, 발표 시 **위 순서대로** 수동 선택합니다.
- 각 시점 전환 후 `explanation` 패널을 활용합니다.
- 라이브 `recall`과 대비할 때는 「데모는 고정 스냅샷, 운영은 실제 DB」임을 명시합니다.

---

## 픽스처·시나리오 확장

### 절차

1. **`fixtures/<scenario-id>.snapshots.ts` 추가** — `export const …Fixture = { scenario_id, question, snapshots }` 형태 (또는 `store.ts`에 `CONSOLIDATION_SNAPSHOTS`처럼 인라인 맵)
2. **`store.ts`에서 ESM import** — `import { …Fixture } from './fixtures/<name>.snapshots.js'` 후 `SNAPSHOTS` spread에 `...buildSnapshotsFromFixture(…Fixture)` 추가 (**JSON import 사용 금지** — 번들/런타임 이슈)
3. **`getters.ts`의 `SCENARIO_CATALOG`에 시나리오·points 등록**
4. **`spec.ts`의 `EVOLUTION_DEMO_SCENARIO_IDS`에 ID 추가**
5. **Zod 스키마·`types.ts`** — 새 선택 필드가 있으면 확장
6. **테스트** — `evolution-demo.spec.ts`, `admin-evolution-demo.routes.spec.ts`
7. **`npm run build`** 후 관련 `vitest` 실행

JSON으로 문안을 초안 작성한 뒤 TS 모듈로 옮기는 것은 가능하지만, **머지 기준 소스는 항상 `.snapshots.ts`** 입니다.

### 네이밍 규칙

- `scenario_id`: kebab-case, URL path 세그먼트로 사용
- `point_id`: 시나리오 내 고유 (예: `early`, `day-30`, `before`)

---

## 향후 DB 시드 전환 절차

현재는 **인코드 픽스처**입니다 (`store.ts`: *Designed for #346 to replace with DB seed later*). **#346 범위는 절차 문서화이며, 마이그레이션 구현은 별도 이슈**입니다.

### 권장 단계

1. **시드 스크립트** (`scripts/seed-evolution-demo.ts` 등) — 시나리오별 `remember` 또는 repository insert
2. **스냅샷 빌더** — 질문·시점에 대한 `memory_summary`·`answer` 생성
3. **기능 플래그** — `EVOLUTION_DEMO_SOURCE=fixture|db` 로 `getters.ts` 분기
4. **운영** — `scripts/seed-evolution-demo.ts` 등 시드 스크립트를 추가한 뒤 [스크립트 인덱스](../operations/ko/scripts-index.md)에 실행 절차를 등록
5. **테스트** — fixture 모드 회귀 + db 모드 통합 테스트

로컬 발표는 당분간 **fixture 모드만으로도 충분**합니다.

---

## 문제 해결

| 증상 | 확인 |
|------|------|
| 데모 탭 에러 | HTTP 서버·로그인·`/admin/evolution-demo/*` 상태 코드 |
| 404 on snapshot | `scenario_id`/`point_id` 오타, 시나리오 미머지 |
| 401 on admin | `ADMIN_API_KEY` 및 `/auth/session` |
| API 없음 | [#341](https://github.com/jee1/memento/issues/341) 이상 머지·`npm run build` |

관련: [보안](../reference/ko/security.md), [개발자 가이드](../guides/ko/developer-guide.md)

---

*문서 이슈: [#346](https://github.com/jee1/memento/issues/346) · 부모: [#80](https://github.com/jee1/memento/issues/80)*
