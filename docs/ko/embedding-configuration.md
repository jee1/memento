# 임베딩 서비스 설정 가이드

## 환경 변수 설정

### 기본 설정

```bash
# .env 파일
EMBEDDING_PROVIDER=minilm
EMBEDDING_DIMENSIONS=384
```

### 제공자별 설정

#### TF-IDF
```bash
EMBEDDING_PROVIDER=tfidf
EMBEDDING_DIMENSIONS=512
```

#### MiniLM
```bash
EMBEDDING_PROVIDER=minilm
EMBEDDING_DIMENSIONS=384
```

#### OpenAI
```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

#### Gemini
```bash
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=text-embedding-004
EMBEDDING_DIMENSIONS=768
```

## 설정 우선순위

1. 명시적 제공자 지정
2. 환경 변수 설정
3. 기본값 (minilm)

## 성능 튜닝

### 메모리 최적화
```bash
# Node.js 힙 크기 증가
NODE_OPTIONS="--max-old-space-size=4096"
```

### 캐시 설정
```typescript
// MiniLM 캐시 크기 조정
const service = new MiniLMEmbeddingService();
// 캐시는 자동으로 관리됨
```
