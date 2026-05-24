# LLM Provider 설정 가이드

## 개요

Memento 프로젝트의 LLM Provider 초기화는 `LLMClientInitializer` 공통 모듈을 통해 일관된 방식으로 관리됩니다. 이 모듈은 OpenAI, Gemini, Ollama 세 가지 LLM 제공자를 지원하며, 자동 fallback 메커니즘을 제공합니다.

## 환경 변수 설정

### 기본 설정

`.env` 파일에 다음 환경 변수를 설정할 수 있습니다:

```bash
# LLM Provider 선택 (선택사항)
# 옵션: 'openai', 'gemini', 'ollama', 'auto' (기본값: 'auto')
LLM_PROVIDER=auto

# OpenAI 설정 (선택사항)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_LLM_MODEL=gpt-4o-mini  # 기본값: gpt-4o-mini

# Gemini 설정 (선택사항)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=text-embedding-004  # 임베딩 전용
GEMINI_LLM_MODEL=gemini-2.0-flash  # LLM 전용 (기본값: gemini-2.0-flash)

# 용도별 LLM 모델 override (선택, 설정 시 provider LLM default보다 우선)
# LLM_MODEL_TRIPLE_EXTRACTION=
# LLM_MODEL_RELATION_EXTRACTION=
# LLM_MODEL_PROCEDURAL=
# LLM_MODEL_CONSOLIDATION=

# Ollama 설정 (선택사항)
OLLAMA_BASE_URL=http://localhost:11434  # 기본값: http://localhost:11434
OLLAMA_MODEL=llama3  # 기본값: llama3
```

### LLM 모델 해석 순서

각 LLM 호출(triple/관계/procedural/consolidation)은 다음 순서로 모델 이름을 선택합니다:

1. 용도별 override (`LLM_MODEL_*`, 설정된 경우)
2. Provider LLM default (`OPENAI_LLM_MODEL`, `GEMINI_LLM_MODEL`, `OLLAMA_MODEL`)
3. 코드 fallback (`gpt-4o-mini`, `gemini-2.0-flash`, `llama3`)

**주의**: `GEMINI_MODEL`은 임베딩 전용입니다. LLM 호출에 사용되지 않습니다.


LLM Provider 선택은 다음 우선순위에 따라 결정됩니다:

1. **`process.env['LLM_PROVIDER']`** (최우선)
   - 런타임 환경 변수로 직접 설정된 값
   - 예: `export LLM_PROVIDER=openai`

2. **`mementoConfig.llmProvider`** (차순위)
   - `.env` 파일에서 읽은 값
   - 또는 코드에서 설정된 값

3. **`'auto'`** (최종 기본값)
   - 위 값들이 모두 없을 경우 자동 선택 모드

## LLMClientInitializer 사용법

**경로 안내**: 아래 TypeScript 예시의 `./src/...` import는 **`packages/memento-core` 디렉터리를 작업 cwd로 둔 경우**를 가정합니다. 저장소 루트에 존재하지 않는 `src/`와 혼동하지 마세요.

### 기본 사용법

```typescript
import { LLMClientInitializer } from './src/shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from './src/shared/services/llm-client-initializer.js';

// LLM 클라이언트 초기화
const initializer = new LLMClientInitializer();
const result: LLMClientInitializationResult = await initializer.initialize();

// 초기화 결과 확인
if (result.preferredProvider) {
  console.log('선택된 Provider:', result.preferredProvider);
  console.log('초기화된 Providers:', result.initializedProviders);
  
  // OpenAI 클라이언트 사용
  if (result.openaiClient) {
    // OpenAI 클라이언트 사용 로직
  }
  
  // Gemini 클라이언트 사용
  if (result.geminiClient) {
    // Gemini 클라이언트 사용 로직
  }
} else {
  console.error('사용 가능한 LLM Provider가 없습니다.');
  console.error('경고 메시지:', result.warnings);
}
```

### API 키 검증

초기화 전에 API 키 존재 여부를 확인할 수 있습니다:

```typescript
const initializer = new LLMClientInitializer();
const apiKeys = initializer.validateApiKeys();

console.log('OpenAI API 키 존재:', apiKeys.openai);
console.log('Gemini API 키 존재:', apiKeys.gemini);
```

### 초기화 결과 구조

`LLMClientInitializationResult` 인터페이스:

```typescript
interface LLMClientInitializationResult {
  /** 선택된 provider (null이면 사용 가능한 provider 없음) */
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  
  /** OpenAI 클라이언트 인스턴스 (초기화 실패 시 null) */
  openaiClient: OpenAI | null;
  
  /** Gemini 클라이언트 인스턴스 (초기화 실패 시 null) */
  geminiClient: GoogleGenerativeAI | null;
  
  /** 성공적으로 초기화된 provider 목록 */
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  
  /** 초기화 과정에서 발생한 경고 메시지 목록 */
  warnings: string[];
}
```

## Provider 선택 및 Fallback 전략

### LLM_PROVIDER='openai'

1. **우선 시도**: OpenAI
   - `OPENAI_API_KEY`가 있으면 OpenAI 클라이언트 초기화
   - 성공 시 `preferredProvider = 'openai'`

2. **Fallback**: Gemini
   - OpenAI 초기화 실패 시 Gemini로 자동 전환
   - `GEMINI_API_KEY`가 있으면 `preferredProvider = 'gemini'`
   - 경고 메시지 로깅: "OpenAI를 사용할 수 없어 Gemini로 fallback합니다."

3. **모두 실패**: `preferredProvider = null`
   - 에러 로그 출력

### LLM_PROVIDER='gemini'

1. **우선 시도**: Gemini
   - `GEMINI_API_KEY`가 있으면 Gemini 클라이언트 초기화
   - 성공 시 `preferredProvider = 'gemini'`

2. **Fallback**: OpenAI
   - Gemini 초기화 실패 시 OpenAI로 자동 전환
   - `OPENAI_API_KEY`가 있으면 `preferredProvider = 'openai'`
   - 경고 메시지 로깅: "Gemini를 사용할 수 없어 OpenAI로 fallback합니다."

3. **모두 실패**: `preferredProvider = null`
   - 에러 로그 출력

### LLM_PROVIDER='ollama'

1. **우선 시도**: Ollama
   - `OLLAMA_BASE_URL`로 연결 테스트 (GET `/api/tags`, 5초 타임아웃)
   - HTTP 200 응답 및 JSON 파싱 성공 시 `preferredProvider = 'ollama'`

2. **Fallback**: OpenAI → Gemini
   - Ollama 연결 실패 시 OpenAI 우선 시도
   - OpenAI도 실패하면 Gemini 시도
   - 경고 메시지 로깅

3. **모두 실패**: `preferredProvider = null`
   - 에러 로그 출력

### LLM_PROVIDER='auto' (기본값)

사용 가능한 첫 번째 provider를 자동 선택:

1. **우선순위 1**: OpenAI
   - `OPENAI_API_KEY`가 있으면 선택

2. **우선순위 2**: Gemini
   - OpenAI가 없고 `GEMINI_API_KEY`가 있으면 선택

3. **우선순위 3**: Ollama
   - OpenAI와 Gemini가 모두 없으면 Ollama 연결 테스트
   - 성공 시 선택

4. **모두 실패**: `preferredProvider = null`

## Ollama 연결 테스트

Ollama는 로컬 서버이므로 연결 테스트가 필요합니다:

- **테스트 엔드포인트**: `GET {OLLAMA_BASE_URL}/api/tags`
- **타임아웃**: 5초
- **성공 조건**: HTTP 200 응답 및 JSON 파싱 성공
- **실패 조건**:
  - HTTP 비-200 응답
  - 타임아웃 (5초)
  - 네트워크 에러 (`ECONNREFUSED`, `ENOTFOUND` 등)

실패 시 경고 메시지가 로그에 기록되고, fallback이 수행됩니다.

## 서비스별 통합 예시

### TripleExtractionService

```typescript
import { TripleExtractionService } from './src/domains/relation/services/triple-extraction/triple-extraction-service.js';

// 서비스 생성 시 자동으로 LLMClientInitializer를 사용하여 초기화
const service = new TripleExtractionService();

// Triple 추출 (자동으로 초기화된 provider 사용)
const result = await service.extractTriples('관찰 텍스트', {
  provider: 'auto'  // 또는 'openai', 'gemini', 'ollama'
});
```

### LLMBasedRelationExtractor

```typescript
import { LLMBasedRelationExtractor } from './src/domains/relation/services/llm-based-relation-extractor.js';

// 서비스 생성 시 자동으로 LLMClientInitializer를 사용하여 초기화
const extractor = new LLMBasedRelationExtractor();

// 관계 추출 (자동으로 초기화된 provider 사용)
const relations = await extractor.extractRelations(newMemory, existingMemories);
```

### TripleExtractor

```typescript
import { TripleExtractor } from './src/domains/relation/services/triple-extraction/triple-extractor.js';

// 서비스 생성 시 자동으로 LLMClientInitializer를 사용하여 초기화
const extractor = new TripleExtractor();

// Triple 추출 (자동으로 초기화된 provider 사용)
const result = await extractor.extract('텍스트', {
  provider: 'auto'  // 또는 'openai', 'gemini', 'ollama'
});
```

## 로깅

LLMClientInitializer는 초기화 과정에서 다음 로그를 출력합니다:

- **`logger.info()`**: 초기화 성공 시
- **`logger.warn()`**: Fallback 발생, API 키 없음 등 경고 상황
- **`logger.error()`**: 모든 provider 초기화 실패 시

로그 메타데이터 형식:

```typescript
logger.warn('LLM 초기화 경고', { 
  warning: 'OPENAI_API_KEY가 없습니다.',
  requestedProvider: 'openai',
  fallbackProvider: 'gemini'
});
```

## 문제 해결

### 모든 Provider가 사용 불가능한 경우

**증상**: `preferredProvider`가 `null`로 반환됨

**원인**:
- API 키가 설정되지 않음
- Ollama 서버가 실행되지 않음
- 네트워크 연결 문제

**해결 방법**:
1. `.env` 파일에 API 키 설정 확인
2. Ollama 서버 실행 확인: `ollama serve`
3. `result.warnings` 배열에서 상세한 오류 메시지 확인

### Ollama 연결 실패

**증상**: Ollama를 선택했지만 연결 실패

**원인**:
- Ollama 서버가 실행되지 않음
- `OLLAMA_BASE_URL`이 잘못 설정됨
- 방화벽 또는 네트워크 문제

**해결 방법**:
1. Ollama 서버 실행 확인: `ollama serve`
2. `OLLAMA_BASE_URL` 환경 변수 확인
3. 브라우저에서 `http://localhost:11434/api/tags` 접근 테스트

### Fallback이 예상대로 동작하지 않는 경우

**증상**: 설정한 provider가 사용되지 않고 다른 provider가 사용됨

**원인**:
- 환경 변수 우선순위 문제
- API 키가 설정되지 않음

**해결 방법**:
1. `process.env['LLM_PROVIDER']` 확인 (최우선)
2. `.env` 파일의 `LLM_PROVIDER` 확인
3. `validateApiKeys()`로 API 키 존재 여부 확인

## 참고 자료

- [LLMClientInitializer 소스 코드](../../../packages/memento-core/src/shared/services/llm-client-initializer.ts)
- [통합 테스트 예시](../../../packages/memento-core/src/domains/relation/services/__tests__/llm-provider-integration/provider-openai.spec.ts)
- [임베딩 서비스 설정 가이드](./embedding-configuration.md)
