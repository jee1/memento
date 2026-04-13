# Research: Embedding Map Dashboard (014)

**Phase**: 0 — Research & Unknowns  
**Date**: 2026-04-13  
**Feature**: `014-embedding-map-dashboard`

---

## 1. umap-js 서버 사이드 사용법

**Decision**: `umap-js` npm 패키지를 `memento-server` 의존성에 추가 (`umap-js` v1.3.x)  
**Rationale**: 공식 UMAP JavaScript 구현체. Node.js 서버 사이드에서 동기적 사용 가능. `new UMAP({ nComponents: 2, nNeighbors: 15 }).fit(vectors)` 호출 후 2D 좌표 배열 반환.  
**Alternatives considered**:
- Python 마이크로서비스 — 별도 프로세스 필요, 운영 복잡도 증가. 거부.
- 브라우저 사이드 UMAP — 클라이언트에 벡터 전체 전송 필요, 보안·성능 모두 나쁨. 거부.

**Key API**:
```ts
import { UMAP } from 'umap-js';
const umap = new UMAP({ nComponents: 2, nNeighbors: 15, minDist: 0.1 });
const embedding2d: number[][] = umap.fit(vectors); // vectors: number[][]
```

**Note**: `umap-js`는 TypeScript 타입 정의 내장. `nNeighbors`는 데이터 수보다 작아야 함 → `Math.min(15, n - 1)` 적용 필요.

---

## 2. K-Means Lloyd's Algorithm

**Decision**: 외부 라이브러리 없이 직접 구현, 최대 100 iteration  
**Rationale**: spec에 명시된 결정. 외부 의존성 최소화. Lloyd's algorithm은 간단하고 안정적.

**구현 스케치**:
```ts
function kMeans(points: number[][], k: number, maxIter = 100): number[] {
  // 1. k개 초기 중심점 랜덤 선택
  // 2. 각 포인트를 가장 가까운 중심점 클러스터에 할당
  // 3. 중심점 재계산
  // 4. 수렴 또는 maxIter 도달까지 반복
  // 반환: 각 포인트의 클러스터 번호 배열 (0-indexed)
}
```

**Edge case**: k > points.length → k를 points.length로 자동 조정 (FR-005).

---

## 3. 임베딩 벡터 DB 쿼리 패턴

**Decision**: `memory_embedding` + `memory_item` JOIN 쿼리  
**Rationale**: 기존 스키마 활용. 임베딩은 JSON 배열 문자열로 저장됨 → `JSON.parse()` 필요.

**쿼리 패턴**:
```sql
SELECT 
  mi.id, mi.content, mi.type, mi.importance, mi.created_at, mi.tags,
  me.embedding
FROM memory_embedding me
JOIN memory_item mi ON me.memory_id = mi.id
WHERE me.embedding_provider = ?
  AND me.projection_type = 'native'
ORDER BY COALESCE(mi.importance, 0.5) DESC
LIMIT ?
```

**주요 컬럼**:
- `memory_embedding.embedding`: TEXT (JSON 배열, `JSON.parse` 후 `number[]`)
- `memory_embedding.embedding_provider`: TEXT (`tfidf`, `minilm`, `openai`, `gemini`)
- `memory_item.importance`: REAL (0.0~1.0, NULL 가능 → 0.5 기본값)
- `memory_item.tags`: TEXT (JSON 배열 문자열)

---

## 4. 인메모리 캐시 구현 패턴

**Decision**: `Map<string, { data: EmbeddingMapResponse; expiresAt: number }>` + 모듈 스코프 싱글턴  
**Rationale**: 서버 재시작 시 초기화 (spec Assumptions). 복잡한 캐시 라이브러리 불필요. LRU 불필요 (파라미터 조합이 적음).

**캐시 키**: `${provider}:${limit}:${effectiveK}` — effectiveK는 자동 조정된 값  
  → k=10, 실제 8개면 캐시 키는 `minilm:300:8` (조정된 k 사용)

**TTL**: 5분 (300,000 ms). 요청 시점에 `Date.now() > expiresAt` 체크. 만료 항목은 lazy 삭제.

---

## 5. Dashboard 탭 통합 패턴

**Decision**: `dashboard.html`에 tab 버튼 + tab panel 구조 추가, JS로 탭 전환  
**Rationale**: 기존 Anchor Map 기능 완전 보존. 새 탭은 별도 JS 파일 `embedding-map.js`로 분리.

**탭 초기화 흐름**:
1. 페이지 로드 → "Anchor Map" 탭 active (기존 동작 유지)
2. "Embedding Map" 탭 클릭 → `loadEmbeddingMap()` 호출 (최초 1회만 자동 로드)
3. 파라미터 변경 후 Load 버튼 클릭 → `loadEmbeddingMap()` 재호출

---

## 6. 새 파일 목록 (요약)

| 파일 | 역할 |
|------|------|
| `packages/memento-server/src/server/routes/admin/admin-embedding-map.routes.ts` | `GET /admin/embedding-map` 라우트 핸들러 |
| `packages/memento-server/src/server/routes/admin/admin-embedding-map-response.ts` | DB 쿼리 + UMAP + K-Means + 캐시 로직 |
| `static/js/embedding-map.js` | 프론트엔드: D3.js scatter plot, 사이드 패널, 툴팁 |
| `static/dashboard.html` | 수정: 탭 UI 추가 |

**수정 파일**:
| 파일 | 변경 내용 |
|------|----------|
| `packages/memento-server/src/server/routes/admin.routes.ts` | `registerAdminEmbeddingMapRoute` 등록 |
| `packages/memento-server/package.json` | `umap-js` 의존성 추가 |

---

## 7. Constitution Check 결과

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First | 준수 필요 | 서버 로직(K-Means, 캐시, 라우트)에 단위 테스트 작성 필요 |
| II. Backward Compatibility | 준수 | 기존 MCP 도구 / admin API 변경 없음 |
| III. Schema & Migration | 해당 없음 | DB 스키마 변경 없음 (기존 테이블 읽기 전용) |
| IV. Quality Gates | 준수 필요 | lint + type-check + test 통과 필요 |
| V. Observability | 준수 권장 | 오류 시 `logger.error` 사용 (기존 패턴 동일) |
