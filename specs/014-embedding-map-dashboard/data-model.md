# Data Model: Embedding Map Dashboard (014)

**Phase**: 1 — Design  
**Date**: 2026-04-13

---

## 기존 스키마 (읽기 전용)

이 기능은 DB 스키마 변경 없이 기존 테이블을 **읽기 전용**으로 사용한다.

### memory_item (기존)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | TEXT PK | 기억 고유 ID |
| `type` | TEXT | `episodic` / `semantic` / `procedural` / `working` |
| `content` | TEXT | 기억 본문 |
| `importance` | REAL | 0.0~1.0, NULL 가능 (기본 0.5) |
| `created_at` | TIMESTAMP | 생성 일시 |
| `tags` | TEXT | JSON 배열 문자열 (`["tag1","tag2"]`) |

### memory_embedding (기존)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `memory_id` | TEXT FK | memory_item.id 참조 |
| `embedding_provider` | TEXT | `tfidf` / `minilm` / `openai` / `gemini` |
| `projection_type` | TEXT | `native` (기본값) |
| `embedding` | TEXT | JSON 배열 문자열 (`[0.1, 0.2, ...]`) |
| `dim` | INTEGER | 벡터 원본 차원 수 |

---

## 새 TypeScript 타입 (런타임 전용, DB 변경 없음)

### EmbeddingPoint

시각화 포인트 하나의 데이터. API 응답 및 프론트엔드 렌더링에 사용.

```ts
interface EmbeddingPoint {
  id: string;           // memory_item.id
  x: number;            // UMAP 2D 좌표 x
  y: number;            // UMAP 2D 좌표 y
  cluster: number;      // K-Means 클러스터 번호 (0-indexed)
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  content: string;      // 전체 본문
  tags: string[];       // 태그 목록
  importance: number;   // 0.0~1.0
  created_at: string;   // ISO 8601 문자열
}
```

### EmbeddingMapResponse

`GET /admin/embedding-map` 응답 스키마.

```ts
interface EmbeddingMapResponse {
  points: EmbeddingPoint[];
  meta: {
    total: number;         // 반환된 포인트 수
    provider: string;      // 사용된 임베딩 provider
    k: number;             // 실제 사용된 k (자동 조정 후)
    requested_k: number;   // 요청된 k (조정 전)
    limit: number;         // 적용된 limit
    cached: boolean;       // 캐시에서 반환 여부
    computed_at: string;   // ISO 8601, 계산 완료 시각
  };
}
```

### EmbeddingMapCacheEntry (서버 내부)

인메모리 캐시 항목. 외부에 노출하지 않음.

```ts
interface EmbeddingMapCacheEntry {
  data: EmbeddingMapResponse;
  expiresAt: number;   // Date.now() 기준 ms
}
```

### EmbeddingMapParams (라우트 파라미터)

```ts
interface EmbeddingMapParams {
  provider: 'tfidf' | 'minilm' | 'openai' | 'gemini';  // 기본: 'minilm'
  limit: number;    // 1~500, 기본: 300
  k: number;        // 2~20, 기본: 6
}
```

---

## 관계 다이어그램

```
memory_item ──< memory_embedding
     id           memory_id (FK)
     content      embedding_provider
     type         embedding (JSON → number[])
     importance   dim
     created_at
     tags

(읽기만 함)
                    ↓
             [DB 쿼리 + JOIN]
                    ↓
             number[][] (벡터 행렬)
                    ↓
               [UMAP fit]
                    ↓
             [x, y] 좌표 배열
                    ↓
               [K-Means]
                    ↓
             cluster 번호 배열
                    ↓
             EmbeddingPoint[]
                    ↓
          EmbeddingMapResponse
                    ↓
          [캐시 저장 / 캐시 반환]
```

---

## 검증 규칙

| 규칙 | 적용 위치 |
|------|----------|
| `provider` ∈ {tfidf, minilm, openai, gemini} | 라우트 핸들러 |
| `limit` ∈ [1, 500] | 라우트 핸들러 |
| `k` ∈ [2, 20] | 라우트 핸들러 |
| 쿼리 결과 < 10건 → 400 에러 | buildEmbeddingMapResponse |
| k > 실제 포인트 수 → k = 실제 포인트 수 | buildEmbeddingMapResponse |
| nNeighbors = min(15, n-1) | UMAP 호출 전 |
