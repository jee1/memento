# Implementation Plan: Embedding Map Dashboard

**Branch**: `014-embedding-map-dashboard` | **Date**: 2026-04-13 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/014-embedding-map-dashboard/spec.md`

---

## Summary

저장된 기억의 임베딩 벡터를 UMAP으로 2D 축소하고 K-Means로 클러스터링하여 `dashboard.html`에 scatter plot 탭으로 추가하는 기능. 서버 사이드에서 `GET /admin/embedding-map` 엔드포인트를 제공하고, 5분 TTL 인메모리 캐시로 반복 요청을 최적화한다.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 20, ES modules  
**Primary Dependencies**: Express 5.x (기존), `umap-js` (신규 추가), D3.js v7 (CDN, 프론트엔드 전용)  
**Storage**: SQLite / better-sqlite3 — 기존 `memory_item` + `memory_embedding` 테이블 읽기 전용. 스키마 변경 없음.  
**Testing**: vitest (기존). 단위 테스트: K-Means 함수, 캐시 로직, 라우트 파라미터 검증.  
**Target Platform**: Linux 서버 (Node.js)  
**Project Type**: Web service (HTTP admin API + 정적 HTML 대시보드)  
**Performance Goals**: 300개 기억 기준 UMAP+K-Means 계산 ≤ 30초 (SC-001); 캐시 히트 ≤ 1초 (SC-002)  
**Constraints**: DB 스키마 변경 없음; 기존 Anchor Map 기능 무변경; Bearer 인증 재사용  
**Scale/Scope**: 최대 500개 기억 포인트, 2~20 클러스터

---

## Constitution Check

| 원칙 | 판정 | 설명 |
|------|------|------|
| I. Test-First (MUST) | 준수 | 서버 로직(K-Means, 캐시, 라우트 검증)에 단위 테스트 먼저 작성 |
| II. Backward Compatibility (MUST) | 준수 | 기존 MCP 도구 및 admin API 변경 없음 |
| III. Schema & Migration (MUST) | 해당 없음 | DB 스키마 변경 없음. 기존 테이블 읽기 전용. |
| IV. Quality Gates (MUST) | 준수 필요 | lint + type-check + test 통과 후 완료 |
| V. Observability (SHOULD) | 준수 | 에러 시 `logger.error` 사용, 계산 시간 로깅 |

**위반 없음.** 복잡성 추적 불필요.

---

## Project Structure

### Documentation (this feature)

```text
specs/014-embedding-map-dashboard/
├── spec.md               # 요구사항 명세
├── plan.md               # 이 파일
├── research.md           # Phase 0 연구 결과
├── data-model.md         # 엔티티 및 타입 정의
├── contracts/
│   └── embedding-map-api.md  # API 계약
└── tasks.md              # Phase 2 (/speckit.tasks 출력, 미생성)
```

### Source Code 변경 목록

```text
packages/memento-server/
├── package.json                                   # umap-js 의존성 추가
└── src/server/routes/
    ├── admin.routes.ts                            # registerAdminEmbeddingMapRoute 호출 추가
    └── admin/
        ├── admin-embedding-map.routes.ts          # 신규: GET /admin/embedding-map 핸들러
        └── admin-embedding-map-response.ts        # 신규: 계산 로직 + 캐시

static/
├── dashboard.html                                 # 수정: 탭 UI 추가
└── js/
    └── embedding-map.js                           # 신규: D3.js scatter plot 프론트엔드
```

**Structure Decision**: 기존 `admin-graph.routes.ts` / `admin-graph-response.ts` 패턴 그대로 복제. 라우트 핸들러와 비즈니스 로직을 분리하는 기존 컨벤션 유지.

---

## Phase 0: Research 완료

→ [`research.md`](./research.md) 참조. 모든 NEEDS CLARIFICATION 해소됨.

핵심 결정 요약:
- `umap-js` npm 패키지를 `memento-server`에 추가
- K-Means는 Lloyd's algorithm 직접 구현 (max 100 iter)
- 캐시 키: `${provider}:${limit}:${effectiveK}` (k 자동 조정 후)
- `nNeighbors = Math.min(15, n - 1)` UMAP 파라미터
- `nEpochs = min(400, max(100, n * 4))` UMAP 학습 에폭 (규모에 따라 100~400으로 클램프)

---

## Phase 1: 구현 계획

### Step 1 — `umap-js` 의존성 추가

**파일**: `packages/memento-server/package.json`

```json
"dependencies": {
  ...existing...
  "umap-js": "^1.3.3"
}
```

이후 `npm install` 실행. `@types/umap-js`는 패키지 자체에 포함됨.

---

### Step 2 — 서버 로직 구현 (TDD)

**파일**: `packages/memento-server/src/server/routes/admin/admin-embedding-map-response.ts`

#### 2-1. 타입 정의

```ts
export interface EmbeddingPoint {
  id: string;
  x: number;
  y: number;
  cluster: number;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  content: string;
  tags: string[];
  importance: number;
  created_at: string;
}

export interface EmbeddingMapResponse {
  points: EmbeddingPoint[];
  meta: {
    total: number;
    provider: string;
    k: number;
    requested_k: number;
    limit: number;
    cached: boolean;
    computed_at: string;
  };
}

export interface EmbeddingMapParams {
  provider: string;
  limit: number;
  k: number;
}
```

#### 2-2. 인메모리 캐시

```ts
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const cache = new Map<string, { data: EmbeddingMapResponse; expiresAt: number }>();

function getCacheKey(provider: string, limit: number, effectiveK: number): string {
  return `${provider}:${limit}:${effectiveK}`;
}
```

#### 2-3. K-Means (Lloyd's algorithm)

```ts
function kMeans(points: number[][], k: number, maxIter = 100): number[]
```

- 랜덤 초기 중심점 k개 선택
- 유클리드 거리 기반 클러스터 할당
- 중심점 재계산
- 수렴 또는 maxIter까지 반복
- 반환: 클러스터 번호 배열 (0-indexed)

#### 2-4. 메인 함수

```ts
export function buildEmbeddingMapResponse(
  db: Database.Database,
  params: EmbeddingMapParams
): EmbeddingMapResponse
```

1. DB JOIN 쿼리로 임베딩 로드 (`embedding_provider = ?`, `projection_type = 'native'`, 활성 기억만 `COALESCE(mi.is_deleted,0)=0`, `LIMIT ?`)
2. 포인트 수 === 0 → `{ code: 'NO_EMBEDDINGS', provider }` 예외
3. 포인트 수 < 10 → `{ code: 'INSUFFICIENT_DATA', count: N }` 예외
4. `effectiveK = Math.min(params.k, points.length)`
5. 캐시 키 생성 (`${provider}:${limit}:${effectiveK}`) → 히트 시 즉시 반환 (`cached: true`)
6. `nNeighbors = Math.min(15, points.length - 1)`; `nEpochs = Math.min(400, Math.max(100, n * 4))`
7. `new UMAP({ nComponents: 2, nNeighbors, nEpochs }).fit(vectors)` → 2D 좌표
8. `kMeans(coords2d, effectiveK)` → 클러스터 번호
9. `EmbeddingPoint[]` 조합
10. 캐시 저장 (TTL 5분)
11. 반환 (`cached: false`)

---

### Step 3 — 라우트 핸들러

**파일**: `packages/memento-server/src/server/routes/admin/admin-embedding-map.routes.ts`

```ts
export function registerAdminEmbeddingMapRoute(
  router: Router,
  db: Database.Database | null
): void
```

`GET /embedding-map` 처리:
1. DB null 체크 → 503
2. 쿼리 파라미터 파싱 및 검증
   - `provider`: tfidf|minilm|openai|gemini (기본 minilm)
   - `limit`: 1~500 정수 (기본 300)
   - `k`: 2~20 정수 (기본 6)
   - 검증 실패 → 400
3. `buildEmbeddingMapResponse(db, params)` 호출
4. 에러 코드별 HTTP 상태 매핑:
   - `INSUFFICIENT_DATA` → 400 (사용자 친화적 메시지 포함)
   - `NO_EMBEDDINGS` → 400
   - `CORRUPTED_EMBEDDINGS` → 500 (`code`, `provider`, `rowCount` 포함)
   - 기타 → 500
5. 성공 → `res.json(result)`

---

### Step 4 — 라우터 등록

**파일**: `packages/memento-server/src/server/routes/admin.routes.ts`

`registerAdminGraphRoute(router, db)` 바로 아래에 추가:

```ts
import { registerAdminEmbeddingMapRoute } from './admin/admin-embedding-map.routes.js';
// ...
registerAdminEmbeddingMapRoute(router, db);
```

---

### Step 5 — 프론트엔드: embedding-map.js

**파일**: `static/js/embedding-map.js`

#### 핵심 함수

```js
// 탭 클릭 시 호출 (최초 1회 자동 로드)
function initEmbeddingMap() { ... }

// 데이터 로드 (자동 + 수동 재로드 공통)
async function loadEmbeddingMap(params) { ... }

// D3.js scatter plot 렌더링
function renderScatterPlot(data) { ... }

// 사이드 패널
function openSidePanel(point) { ... }
function closeSidePanel() { ... }
```

#### D3.js scatter plot 상세

- SVG에 `d3.zoom()` 적용 → 휠 줌 + 드래그 패닝 (FR-010)
- 클러스터별 색상: `d3.schemeTableau10` 팔레트
- 점 반지름: `r = 4 + point.importance * 6` → 반지름 4~10px (FR-007)
- `mouseover` → 툴팁: content 앞 80자 + type (FR-008)
- `click` → 사이드 패널 열기 (FR-009)
- SVG 배경 클릭 + Escape 키 → 사이드 패널 닫기
- 캐시 히트 시: `"N분 전 캐시"` 표시 (FR-011)

---

### Step 6 — dashboard.html 탭 통합

**파일**: `static/dashboard.html`

1. 기존 Anchor Map 콘텐츠를 `<div id="tab-anchor-map" class="tab-panel">` 로 감싸기
2. `<div class="tab-bar">` + 두 탭 버튼 추가 (Anchor Map | Embedding Map)
3. Embedding Map 탭 패널 추가 (컨트롤 바 + SVG 컨테이너 + 사이드 패널)
4. `<script src="/static/js/embedding-map.js"></script>` 추가

---

### Step 7 — 단위 테스트

**파일**: `packages/memento-server/src/server/routes/admin/admin-embedding-map-response.spec.ts`

| 테스트 케이스 | 검증 항목 |
|-------------|----------|
| K-Means: k=3, 9개 포인트 | 출력 배열 길이 9, 클러스터 번호 0~2 범위 (특정 번호 단언 금지 — 비결정적 알고리즘) |
| K-Means: k > n → k=n | effectiveK === n |
| 캐시 히트: 동일 파라미터 재요청 | `cached: true`, `computed_at` 동일 |
| 캐시 만료: TTL 경과 | `cached: false`, 새 `computed_at` |
| provider 임베딩 0건 → NO_EMBEDDINGS | 에러 코드, provider 값 (count===0일 때 INSUFFICIENT_DATA 아님) |
| 포인트 수 1~9건 → INSUFFICIENT_DATA | 에러 코드, count 값 |
| 라우트: 잘못된 provider → 400 | status, message 검증 |
| 라우트: limit=0 → 400 | status 검증 |
| 라우트: k=1 → 400 | status 검증 |

---

## 파일별 구현 순서 (의존성 기반)

```
1. admin-embedding-map-response.spec.ts  (TDD: 테스트 먼저)
2. admin-embedding-map-response.ts       (핵심 로직)
3. admin-embedding-map.routes.ts         (라우트)
4. admin.routes.ts                       (등록)
5. package.json + npm install            (umap-js)
6. embedding-map.js                      (프론트엔드)
7. dashboard.html                        (탭 통합)
```

---

## 위험 요소 및 완화

| 위험 | 완화 방법 |
|------|----------|
| UMAP 계산이 30초 초과할 수 있음 | `limit` 기본값 300으로 제한; nNeighbors를 min(15, n-1)로 제한 |
| umap-js 타입 정의 문제 | 패키지 내장 타입 사용; 없으면 `declare module` fallback |
| D3.js 탭 전환 시 SVG 크기 문제 | 탭 활성화 후 명시적 width/height 설정 또는 resize 이벤트 |
| 기존 Anchor Map 스크립트 충돌 | `embedding-map.js`를 완전 분리된 스코프로 유지 |
| k > 실제 포인트 수 엣지케이스 | `effectiveK = Math.min(params.k, points.length)` 항상 적용 |

---

## 완료 기준 (constitution IV)

- [ ] `npm run lint` 통과
- [ ] `npm run type-check` 통과
- [ ] `npm test` 통과 (신규 단위 테스트 포함)
- [ ] 수동 검증: 탭 클릭 → 자동 로드 → scatter plot 렌더링
- [ ] 수동 검증: 점 클릭 → 사이드 패널 열기 / X·Escape·빈 공간 → 닫기
- [ ] 수동 검증: 캐시 히트 시 "N분 전 캐시" 표시
- [ ] 수동 성능 검증: 300개 기억 기준 첫 응답 ≤30초(SC-001), 캐시 히트 ≤1초(SC-002)
- [ ] 수동 정확도 검증: 유사 주제 기억이 같은 클러스터에 그룹화되는지 샘플 육안 검증(SC-003)
