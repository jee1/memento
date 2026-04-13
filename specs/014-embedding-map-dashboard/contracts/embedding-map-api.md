# API Contract: GET /admin/embedding-map

**Feature**: 014-embedding-map-dashboard  
**Auth**: Bearer token (Admin API Key, 기존 패턴 동일)  
**Base path**: `/admin`

---

## Endpoint

```
GET /admin/embedding-map
```

### Query Parameters

| 파라미터 | 타입 | 기본값 | 범위 | 설명 |
|---------|------|--------|------|------|
| `provider` | string | `minilm` | tfidf \| minilm \| openai \| gemini | 임베딩 provider |
| `limit` | integer | `300` | 1~500 | 조회할 최대 기억 수 |
| `k` | integer | `6` | 2~20 | K-Means 클러스터 수 |

### Success Response: 200 OK

```json
{
  "points": [
    {
      "id": "mem_abc123",
      "x": -2.341,
      "y": 1.089,
      "cluster": 2,
      "type": "semantic",
      "content": "전체 기억 본문...",
      "tags": ["knowledge", "best-practice"],
      "importance": 0.8,
      "created_at": "2026-03-15T10:30:00.000Z"
    }
  ],
  "meta": {
    "total": 142,
    "provider": "minilm",
    "k": 6,
    "requested_k": 6,
    "limit": 300,
    "cached": false,
    "computed_at": "2026-04-13T09:15:32.000Z"
  }
}
```

### Error Responses

**400 — 기억 수 부족**
```json
{
  "error": "기억 부족",
  "message": "임베딩 맵을 그리려면 최소 10개의 기억이 필요합니다. (현재 7개)",
  "count": 7
}
```

**400 — 파라미터 오류**
```json
{
  "error": "잘못된 파라미터",
  "message": "provider는 tfidf, minilm, openai, gemini 중 하나여야 합니다"
}
```

**400 — 임베딩 없음**
```json
{
  "error": "임베딩 없음",
  "message": "minilm 임베딩이 아직 없습니다. 기억을 더 저장하면 자동 생성됩니다.",
  "provider": "minilm"
}
```

**503 — DB 미연결**
```json
{
  "error": "Service unavailable"
}
```

**500 — 임베딩 JSON 손상/파싱 불가** (DB에 행은 있으나 유효 벡터 0개)
```json
{
  "error": "임베딩 데이터 손상",
  "message": "저장된 임베딩 벡터를 파싱할 수 없습니다. DB 정합성(embedding JSON)을 확인하세요.",
  "code": "CORRUPTED_EMBEDDINGS",
  "provider": "minilm",
  "rowCount": 12
}
```

**500 — 서버 오류**
```json
{
  "error": "임베딩 맵 계산 실패",
  "message": "..."
}
```

---

## 동작 규칙

1. **캐시**: 동일 파라미터 (`provider:limit:effectiveK`) 재요청 시 5분 이내면 캐시 반환 (`cached: true`)
2. **k 자동 조정**: 요청 k > 실제 포인트 수 → k를 포인트 수로 조정. `requested_k`에 원래 값 보존.
3. **nNeighbors**: `Math.min(15, n - 1)` 적용 (UMAP 제약)
4. **nEpochs**: `Math.min(400, Math.max(100, n * 4))` (UMAP 학습 에폭)
5. **임베딩 없는 기억**: JOIN 실패 → 제외 (오류 아님)
6. **소프트 삭제**: `memory_item.is_deleted`가 참인 행은 조회에서 제외
7. **인증**: `Authorization: Bearer <ADMIN_API_KEY>` 필수. 미인증 시 401.

---

## 캐시 키 전략

```
캐시 키 = `${provider}:${limit}:${effectiveK}`
```

- `effectiveK`는 k 자동 조정 이후 값 사용
- 요청 k=10, 실제 8개 기억 → effectiveK=8, 캐시 키 `minilm:300:8`
- TTL: 5분 (300,000 ms), 서버 재시작 시 초기화
