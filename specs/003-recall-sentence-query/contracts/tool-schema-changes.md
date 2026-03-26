# Tool Schema Contract Changes

**Branch**: `003-recall-sentence-query` | **Date**: 2026-03-24

## recall 도구 — query 파라미터 설명 변경

**파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts` (라인 405-407)

### Before
```json
{
  "query": {
    "type": "string",
    "description": "검색 쿼리 (type이 core 또는 vault가 아닌 경우 필수). memory_types만 제공된 경우에도 query는 필수입니다."
  }
}
```

### After
```json
{
  "query": {
    "type": "string",
    "description": "검색할 내용을 자연어 문장으로 입력하세요 (예: '지난번에 JWT 토큰 만료 처리한 방법이 뭐였지?'). 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다. type이 core 또는 vault가 아닌 경우 필수이며, memory_types만 제공된 경우에도 query는 필수입니다."
  }
}
```

---

## memory_injection 도구 — query 파라미터 설명 변경

**파일**: `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts`

### Before (Zod, 라인 18-19)
```typescript
query: z.string().describe('검색할 쿼리')
```

### After (Zod)
```typescript
query: z.string().describe('검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.')
```

### Before (JSON Schema, 라인 34-36)
```json
{ "type": "string", "description": "검색할 쿼리" }
```

### After (JSON Schema)
```json
{ "type": "string", "description": "검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다." }
```

---

## recall 응답 메타데이터 — embedding_provider 필드 추가

**타입**: `RecallResponseMetadata` (optional 필드, 하위 호환)

```typescript
{
  "embedding_provider": "minilm"  // 또는 "tfidf", "openai", "gemini"
}
```

**노출 조건**: `include_metadata: true`일 때 (기존 진단 필드와 동일 조건)

---

## TF-IDF Fallback 경고 — stderr 출력 형식

recall/memory_injection 실행 중 TF-IDF로 fallback 된 경우 출력:

```
⚠️ [Memento] TF-IDF fallback 활성화: 기본 임베딩 제공자({원래 provider}) 사용 불가. 의미 기반 검색 품질이 저하될 수 있습니다.
```
