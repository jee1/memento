# 임베딩 서비스 API 레퍼런스

`remember`·`recall`·하이브리드 검색은 모두 임베딩 벡터를 거칩니다. `@memento/core`의 **`UnifiedEmbeddingService`**가 제공자 우선순위·폴백·차원 검증을 한곳에서 처리하므로, MCP 도구나 HTTP API를 직접 건드리지 않고 임베딩 동작을 바꾸려면 이 클래스의 계약을 보면 됩니다. 아래는 TypeScript 호출면 기준 레퍼런스이며, 환경 변수 설정은 [embedding-configuration.md](../../guides/ko/embedding-configuration.md)를 참고하세요.

## UnifiedEmbeddingService

통합 임베딩 서비스의 메인 클래스입니다. 여러 `EmbeddingProvider` 구현을 등록해 두고, `generateEmbedding` 호출 시 가용한 제공자 중 하나를 선택합니다.

### 생성자

```typescript
new UnifiedEmbeddingService()
```

### 메서드

#### generateEmbedding(text, preferredProvider?)

텍스트를 임베딩 벡터로 변환합니다.

**매개변수:**
- `text: string` - 변환할 텍스트
- `preferredProvider?: EmbeddingProvider` - 선호하는 제공자 (선택사항)

**반환값:**
```typescript
Promise<EmbeddingResult | null>
```

**예시:**
```typescript
const result = await service.generateEmbedding('안녕하세요');
console.log(result.embedding); // [0.1, 0.2, ...]
console.log(result.model); // 'minilm'
```

#### searchSimilar(query, embeddings, limit?, threshold?)

유사한 임베딩을 검색합니다.

**매개변수:**
- `query: string` - 검색 쿼리
- `embeddings: EmbeddingData[]` - 검색할 임베딩 배열
- `limit?: number` - 결과 개수 제한 (기본값: 10)
- `threshold?: number` - 유사도 임계값 (기본값: 0.7)

**반환값:**
```typescript
Promise<SimilarityResult[]>
```

**예시:**
```typescript
const results = await service.searchSimilar('React', memories, 5, 0.8);
```

#### isAvailable()

서비스 사용 가능 여부를 확인합니다.

**반환값:**
```typescript
boolean
```

#### getCurrentProviderName()

현재 사용 중인 제공자 이름을 반환합니다.

**반환값:**
```typescript
string
```

#### getModelInfo()

현재 모델 정보를 반환합니다.

**반환값:**
```typescript
{ model: string; dimensions: number; maxTokens: number }
```

## 타입 정의

### EmbeddingResult

```typescript
interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
```

### SimilarityResult

```typescript
interface SimilarityResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
}
```

### EmbeddingData

```typescript
interface EmbeddingData {
  id: string;
  content: string;
  embedding: number[];
}
```

### EmbeddingProvider

```typescript
type EmbeddingProvider = 'tfidf' | 'minilm' | 'openai' | 'gemini';
```
