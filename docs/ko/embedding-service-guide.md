# 임베딩 서비스 사용 가이드

## 개요

Memento 프로젝트의 임베딩 서비스는 4가지 제공자를 지원하는 통합 시스템입니다:
- **TF-IDF**: 빠른 속도, 512차원, 무료
- **MiniLM**: 균형잡힌 성능, 384차원, 무료
- **OpenAI**: 최고 성능, 1536차원, 유료
- **Gemini**: 고성능, 768차원, 유료

## 빠른 시작

### 1. 기본 사용법

```typescript
import { UnifiedEmbeddingService } from './src/services/unified-embedding-service.js';

const embeddingService = new UnifiedEmbeddingService();

// 텍스트 임베딩 생성
const result = await embeddingService.generateEmbedding('안녕하세요, Memento입니다!');
console.log('임베딩 차원:', result.embedding.length);
console.log('사용된 모델:', result.model);

// 유사도 검색
const memories = [
  { id: '1', content: 'React Hook 사용법', embedding: [0.1, 0.2, ...] },
  { id: '2', content: 'TypeScript 타입 정의', embedding: [0.3, 0.4, ...] }
];

const similar = await embeddingService.searchSimilar('React 관련 질문', memories, 5, 0.7);
console.log('유사한 메모리:', similar);
```

### 2. 환경 설정

`.env` 파일에 설정:

```bash
# 기본 임베딩 제공자 선택
EMBEDDING_PROVIDER=minilm  # 옵션: tfidf, minilm, openai, gemini

# OpenAI 설정 (선택사항)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=text-embedding-3-small

# Gemini 설정 (선택사항)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=text-embedding-004

# 임베딩 차원 (자동 설정됨)
EMBEDDING_DIMENSIONS=384  # MiniLM 기본값
```

## 제공자별 상세 가이드

### TF-IDF 제공자

**특징**:
- ⚡ 극도로 빠른 속도 (0.82ms 평균)
- 💾 낮은 메모리 사용량 (4.48MB)
- 🆓 완전 무료
- 📊 512차원 벡터

**사용 시나리오**:
- 대량 텍스트 처리
- 실시간 검색
- 리소스 제약 환경

```typescript
import { LightweightEmbeddingService } from './src/services/lightweight-embedding-service.js';

const tfidfService = new LightweightEmbeddingService();
const result = await tfidfService.generateEmbedding('빠른 처리가 필요한 텍스트');
```

### MiniLM 제공자

**특징**:
- 🎯 균형잡힌 성능 (56.50ms 평균)
- 🧠 의미 이해 능력
- 🆓 완전 무료
- 📊 384차원 벡터

**사용 시나리오**:
- 일반적인 AI Agent 용도
- 의미 기반 검색
- 성능과 정확성의 균형

```typescript
import { MiniLMEmbeddingService } from './src/services/minilm-embedding-service.js';

const minilmService = new MiniLMEmbeddingService();
const result = await minilmService.generateEmbedding('의미를 이해해야 하는 텍스트');
```

### OpenAI 제공자

**특징**:
- 🏆 최고 성능
- 🧠 뛰어난 의미 이해
- 💰 유료 (API 비용)
- 📊 1536차원 벡터

**사용 시나리오**:
- 고품질 임베딩 필요
- 복잡한 의미 분석
- 비용을 감수할 수 있는 경우

```typescript
// 환경 변수에 OPENAI_API_KEY 설정 필요
const result = await embeddingService.generateEmbedding('고품질 임베딩이 필요한 텍스트');
```

### Gemini 제공자

**특징**:
- 🚀 고성능
- 🌍 다국어 지원
- 💰 유료 (API 비용)
- 📊 768차원 벡터

**사용 시나리오**:
- 다국어 텍스트 처리
- Google 생태계 활용
- 고성능이 필요한 경우

```typescript
// 환경 변수에 GEMINI_API_KEY 설정 필요
const result = await embeddingService.generateEmbedding('다국어 텍스트');
```

## 고급 사용법

### 1. 제공자 직접 선택

```typescript
// 특정 제공자 강제 사용
const result = await embeddingService.generateEmbedding(
  '텍스트', 
  'minilm'  // 제공자 명시
);
```

### 2. 폴백 메커니즘

```typescript
// 폴백 제공자 설정
embeddingService.setFallbackProviders(['minilm', 'tfidf']);

// 기본 제공자 실패 시 자동으로 폴백 제공자 시도
const result = await embeddingService.generateEmbedding('텍스트');
```

### 3. 서비스 상태 확인

```typescript
// 사용 가능 여부 확인
if (embeddingService.isAvailable()) {
  const result = await embeddingService.generateEmbedding('텍스트');
}

// 현재 사용 중인 제공자 확인
const currentProvider = embeddingService.getCurrentProviderName();
console.log('현재 제공자:', currentProvider);

// 모델 정보 확인
const modelInfo = embeddingService.getModelInfo();
console.log('모델 정보:', modelInfo);
```

## 성능 최적화

### 1. 배치 처리

```typescript
// 여러 텍스트를 동시에 처리
const texts = ['텍스트1', '텍스트2', '텍스트3'];
const results = await Promise.all(
  texts.map(text => embeddingService.generateEmbedding(text))
);
```

### 2. 캐싱 활용

```typescript
// MiniLM 서비스는 자동으로 캐싱됨
const result1 = await minilmService.generateEmbedding('같은 텍스트'); // 모델 로딩
const result2 = await minilmService.generateEmbedding('같은 텍스트'); // 캐시에서 반환
```

### 3. 메모리 관리

```typescript
// 대량 처리 시 메모리 정리
for (const text of largeTextArray) {
  const result = await embeddingService.generateEmbedding(text);
  // 결과 처리
  // 가비지 컬렉션을 위해 참조 해제
}
```

## 에러 처리

### 1. 기본 에러 처리

```typescript
try {
  const result = await embeddingService.generateEmbedding('텍스트');
} catch (error) {
  if (error.message.includes('텍스트가 비어있습니다')) {
    console.error('입력 텍스트를 확인해주세요');
  } else if (error.message.includes('사용 가능한 제공자가 없습니다')) {
    console.error('모든 임베딩 제공자가 사용 불가능합니다');
  } else {
    console.error('임베딩 생성 실패:', error.message);
  }
}
```

### 2. 제공자별 에러 처리

```typescript
try {
  const result = await embeddingService.generateEmbedding('텍스트');
} catch (error) {
  // OpenAI API 에러
  if (error.status === 429) {
    console.error('API 할당량 초과');
  } else if (error.status === 401) {
    console.error('API 키가 유효하지 않습니다');
  }
  
  // Gemini API 에러
  if (error.message.includes('quota')) {
    console.error('Gemini API 할당량 초과');
  }
}
```

## 테스트

### 1. 단위 테스트

```typescript
import { describe, it, expect } from 'vitest';
import { UnifiedEmbeddingService } from '../src/services/unified-embedding-service.js';

describe('임베딩 서비스 테스트', () => {
  it('텍스트 임베딩 생성', async () => {
    const service = new UnifiedEmbeddingService();
    const result = await service.generateEmbedding('테스트 텍스트');
    
    expect(result).toBeDefined();
    expect(result.embedding).toBeInstanceOf(Array);
    expect(result.embedding.length).toBeGreaterThan(0);
  });
});
```

### 2. 성능 벤치마크

```bash
# 벤치마크 실행
npm run benchmark:embedding

# 특정 서비스 테스트
npm run test:embedding-benchmark
```

## 문제 해결

### 1. 일반적인 문제

**Q: MiniLM 모델 로딩이 느려요**
A: 첫 번째 호출 시에만 모델을 로딩합니다. 이후 호출은 캐시에서 빠르게 처리됩니다.

**Q: OpenAI API 에러가 발생해요**
A: API 키가 올바른지, 할당량이 남아있는지 확인해주세요.

**Q: 벡터 차원이 맞지 않아요**
A: 각 제공자는 다른 차원을 사용합니다. 통합 서비스를 사용하면 자동으로 처리됩니다.

### 2. 성능 문제

**Q: 임베딩 생성이 너무 느려요**
A: TF-IDF 제공자를 사용하거나, 배치 처리를 고려해보세요.

**Q: 메모리 사용량이 많아요**
A: MiniLM 모델이 메모리를 많이 사용합니다. TF-IDF를 사용하거나 서버 리소스를 늘려보세요.

## 마이그레이션 가이드

### 기존 코드에서 통합 서비스로 마이그레이션

```typescript
// 기존 코드
import { EmbeddingService } from './src/services/embedding-service.js';
const oldService = new EmbeddingService();

// 새로운 코드
import { UnifiedEmbeddingService } from './src/services/unified-embedding-service.js';
const newService = new UnifiedEmbeddingService();

// API는 동일하므로 코드 변경 최소화
const result = await newService.generateEmbedding('텍스트');
```

## 추가 리소스

- [성능 벤치마크 결과](./embedding-performance-benchmark.md)
- [API 레퍼런스](./embedding-api-reference.md)
- [설정 가이드](./embedding-configuration.md)
- [문제 해결 FAQ](./embedding-troubleshooting.md)
