# 임베딩 서비스 API 레퍼런스

## UnifiedEmbeddingService

통합 임베딩 서비스의 메인 클래스입니다.

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
