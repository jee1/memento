# 작업 목록: LLM Provider 초기화 로직 개선 및 통일

이 문서는 [0024-prd-llm-provider-initialization-fix.md](./0024-prd-llm-provider-initialization-fix.md) PRD를 기반으로 생성된 작업 목록입니다.

## Relevant Files

- `src/shared/services/llm-client-initializer.ts` - LLM 클라이언트 초기화를 위한 공통 모듈 (새로 생성)
- `src/shared/services/llm-client-initializer.spec.ts` - `llm-client-initializer.ts`에 대한 단위 테스트 (새로 생성, 동일 디렉토리)
- `src/domains/relation/services/triple-extraction/triple-extraction-service.ts` - TripleExtractionService 리팩토링 대상
- `src/domains/relation/services/triple-extraction/triple-extraction-service.spec.ts` - `triple-extraction-service.ts`에 대한 단위 테스트 업데이트 필요 (동일 디렉토리)
- `src/domains/relation/services/llm-based-relation-extractor.ts` - LLMBasedRelationExtractor 리팩토링 대상
- `src/domains/relation/services/llm-based-relation-extractor.spec.ts` - `llm-based-relation-extractor.ts`에 대한 단위 테스트 업데이트 필요 (동일 디렉토리로 이동 또는 새로 작성)
- `src/domains/relation/services/triple-extraction/triple-extractor.ts` - TripleExtractor 리팩토링 대상
- `src/domains/relation/services/triple-extraction/triple-extractor.spec.ts` - `triple-extractor.ts`에 대한 단위 테스트 업데이트 필요 (동일 디렉토리로 이동 또는 새로 작성)
- `src/shared/config/index.ts` - mementoConfig 정의 확인용 참고 파일
- `src/shared/config/environment.ts` - 환경 변수 처리 확인용 참고 파일

### Notes

#### 테스트 파일 위치 및 네이밍 규칙
- **테스트 파일 네이밍**: 
  - 단위 테스트: `*.spec.ts` 형식 사용 (예: `llm-client-initializer.spec.ts`)
  - 통합 테스트: `*.integration.spec.ts` 형식 사용 (예: `llm-provider-integration.spec.ts`)
- **테스트 파일 위치**: 
  - **단위 테스트**: 테스트하는 코드 파일과 **동일한 디렉토리**에 배치
    - 예: `src/shared/services/llm-client-initializer.ts`와 `src/shared/services/llm-client-initializer.spec.ts`
    - 예: `src/domains/relation/services/triple-extraction/triple-extraction-service.ts`와 `src/domains/relation/services/triple-extraction/triple-extraction-service.spec.ts`
  - **통합 테스트**: `__tests__` 디렉토리에 배치
    - 예: `src/domains/relation/services/__tests__/llm-provider-integration.spec.ts`
  - **신규 파일 규칙**: 새로 생성하는 테스트는 위 규칙을 따라야 함
    - 단위 테스트는 동일 디렉토리에 생성
    - 통합 테스트는 `__tests__` 디렉토리에 생성
  - **기존 파일 처리**: 기존에 `__tests__` 디렉토리에 있는 단위 테스트는 그대로 유지 (점진적 이동은 별도 이슈로 처리)
- **테스트 실행**: `npm test`를 사용하여 테스트를 실행합니다. 경로 없이 실행하면 Vitest 구성에서 찾은 모든 테스트를 실행합니다.

#### TDD 방법론
- 모든 구현 작업은 TDD 방법론(RED-GREEN-REFACTOR)을 따라야 합니다.
- 테스트 코드는 `given/when/then` 구조를 따라야 하며, 메서드명 또는 JSDoc에도 `given/when/then`을 표시해야 합니다.

#### 로깅 표준
- **로거 인스턴스**: `src/shared/utils/logger.ts`에서 제공하는 중앙화된 `logger` 사용
  ```typescript
  import { logger } from '../../shared/utils/logger.js';
  ```
- **로그 레벨**: `'debug' | 'info' | 'warn' | 'error'` 중 하나 사용
- **로그 메서드**: 
  - `logger.info()`: 정보성 메시지 (초기화 성공 등)
  - `logger.warn()`: 경고 메시지 (fallback 발생, API 키 없음 등)
  - `logger.error()`: 에러 메시지 (초기화 실패, 모든 provider 실패 등)
- **메타데이터 형식**: `Record<string, unknown>` 형식의 객체로 전달
  ```typescript
  logger.warn('LLM_PROVIDER 설정 오류', { 
    requestedProvider: 'openai',
    reason: 'OPENAI_API_KEY가 없습니다',
    fallbackProvider: 'gemini'
  });
  ```

#### E2E 테스트 실행 조건
- **모킹/스텁 사용**: 실제 API 키나 외부 서비스에 의존하지 않도록 모킹/스텁 사용
- **실행 조건 명시**: 
  - CI 환경에서는 모킹된 테스트만 실행
  - 로컬 환경에서 실제 API 키가 있는 경우에만 선택적 실행 (옵션 태그 사용)
  - 예: `npm test -- --grep "E2E"` 또는 `npm test -- --grep "@integration"`
- **재현성 보장**: 테스트는 환경에 관계없이 동일한 결과를 보장해야 함

#### Ollama 연결 테스트 실패 조건
- **실패 조건 명시**:
  - HTTP 비-200 응답: `response.ok === false` → null 반환 및 경고 로그
  - 타임아웃 (5초): `AbortSignal.timeout` 발생 → null 반환 및 경고 로그
  - 네트워크 에러: `fetch failed`, `ECONNREFUSED`, `ENOTFOUND` → null 반환 및 경고 로그
- **성공 기준**: HTTP 200 응답 및 JSON 파싱 성공 → 'ollama' 반환

## Tasks

- [x] 1.0 LLMClientInitializer 공통 모듈 생성
  - [x] 1.1 [RED] LLMClientInitializationResult 인터페이스와 LLMClientInitializer 클래스에 대한 실패하는 테스트 작성
  - [x] 1.2 [GREEN] LLMClientInitializationResult 인터페이스와 LLMClientInitializer 클래스 정의하여 테스트 통과
  - [x] 1.3 [RED] 환경 변수 우선순위(process.env['LLM_PROVIDER'] > mementoConfig.llmProvider > 'auto')를 검증하는 테스트 작성
  - [x] 1.4 [GREEN] 환경 변수 우선순위 처리 로직 구현하여 테스트 통과
  - [x] 1.5 [RED] OpenAI 클라이언트 초기화(API 키 있으면 생성, 없으면 null 반환 및 경고 추가)를 검증하는 테스트 작성
  - [x] 1.6 [GREEN] OpenAI 클라이언트 초기화 로직 구현하여 테스트 통과
  - [x] 1.7 [RED] Gemini 클라이언트 초기화(API 키 있으면 생성, 없으면 null 반환 및 경고 추가)를 검증하는 테스트 작성
  - [x] 1.8 [GREEN] Gemini 클라이언트 초기화 로직 구현하여 테스트 통과
  - [x] 1.9 [RED] Ollama 연결 테스트(GET {OLLAMA_BASE_URL}/api/tags, 5초 타임아웃)를 검증하는 테스트 작성 - 성공(HTTP 200 + JSON 파싱 성공 → 'ollama' 반환), 실패(비-200/타임아웃/네트워크 에러 → null 반환 및 경고 로그) 케이스 포함
  - [x] 1.10 [GREEN] Ollama 연결 테스트 로직 구현하여 테스트 통과
  - [x] 1.11 [RED] LLM_PROVIDER='openai'일 때 OpenAI 우선 시도, 실패 시 Gemini fallback, 모두 실패 시 null 반환 및 경고를 검증하는 테스트 작성
  - [x] 1.12 [GREEN] LLM_PROVIDER='openai' fallback 로직 구현하여 테스트 통과
  - [x] 1.13 [RED] LLM_PROVIDER='gemini'일 때 Gemini 우선 시도, 실패 시 OpenAI fallback, 모두 실패 시 null 반환 및 경고를 검증하는 테스트 작성
  - [x] 1.14 [GREEN] LLM_PROVIDER='gemini' fallback 로직 구현하여 테스트 통과
  - [x] 1.15 [RED] LLM_PROVIDER='ollama'일 때 Ollama 우선 시도, 실패 시 OpenAI/Gemini fallback, 모두 실패 시 null 반환 및 경고를 검증하는 테스트 작성
  - [x] 1.16 [GREEN] LLM_PROVIDER='ollama' fallback 로직 구현하여 테스트 통과
  - [x] 1.17 [RED] LLM_PROVIDER='auto'일 때 OpenAI -> Gemini -> Ollama 순서로 사용 가능한 첫 번째 provider 선택을 검증하는 테스트 작성
  - [x] 1.18 [GREEN] LLM_PROVIDER='auto' 로직 구현하여 테스트 통과
  - [x] 1.19 [RED] validateApiKeys() 메서드(각 provider의 API 키 존재 여부를 boolean 객체로 반환)를 검증하는 테스트 작성
  - [x] 1.20 [GREEN] validateApiKeys() 메서드 구현하여 테스트 통과
  - [x] 1.21 [REFACTOR] 코드 리팩토링(중복 제거, 가독성 향상, 성능 최적화) 수행하되 모든 테스트가 계속 통과하는지 확인

- [ ] 2.0 TripleExtractionService 리팩토링
  - [ ] 2.1 [RED] initializeClients()가 LLMClientInitializer.initialize()를 호출하는 것을 검증하는 테스트 작성
  - [ ] 2.2 [GREEN] initializeClients() 메서드에서 LLMClientInitializer.initialize()를 호출하도록 변경하여 테스트 통과
  - [ ] 2.3 [RED] LLMClientInitializer 결과를 사용하여 openaiClient, geminiClient, preferredProvider를 설정하고 warnings를 logger.warn()으로 출력하는 것을 검증하는 테스트 작성 (로깅 표준 준수)
  - [ ] 2.4 [GREEN] LLMClientInitializer의 결과를 사용하여 클라이언트를 설정하여 테스트 통과
  - [ ] 2.5 [RED] determineProvider() 메서드가 요청된 provider와 초기화 상태를 확인하여 사용 가능한 provider를 반환하는 것을 검증하는 테스트 작성
  - [ ] 2.6 [GREEN] determineProvider() 메서드 구현하여 테스트 통과
  - [ ] 2.7 [RED] preferredProvider가 null이거나 클라이언트가 초기화되지 않았을 때 다른 사용 가능한 provider로 자동 전환하고, 모든 provider가 사용 불가능하면 null을 반환하는 것을 검증하는 테스트 작성
  - [ ] 2.8 [GREEN] fallback 로직 구현하여 테스트 통과
  - [ ] 2.9 [RED] extractWithLLM()에서 actualProvider가 null일 때 failureReason을 'llm_unavailable'로 설정하고 명확한 에러 메시지를 반환하는 것을 검증하는 테스트 작성
  - [ ] 2.10 [GREEN] 에러 처리 로직 구현하여 테스트 통과
  - [ ] 2.11 [REFACTOR] 코드 리팩토링(중복 제거, 가독성 향상, 성능 최적화) 수행하되 모든 기존 테스트와 새로운 테스트가 계속 통과하는지 확인

- [ ] 3.0 LLMBasedRelationExtractor 리팩토링
  - [ ] 3.1 [RED] initializeClients()가 async로 변경되어 LLMClientInitializer.initialize()를 호출하는 것을 검증하는 테스트 작성
  - [ ] 3.2 [GREEN] initializeClients() 메서드를 async로 변경하여 LLMClientInitializer.initialize()를 호출하도록 변경하여 테스트 통과
  - [ ] 3.3 [RED] constructor에서 async initializeClients()를 사용할 수 있도록 초기화 로직을 조정하거나 초기화 지연 방식을 적용하는 것을 검증하는 테스트 작성
  - [ ] 3.4 [GREEN] 초기화 로직을 조정하거나 초기화 지연 방식을 적용하여 테스트 통과
  - [ ] 3.5 [RED] LLMClientInitializer 결과를 사용하여 openaiClient, geminiClient, preferredProvider를 설정하고 warnings를 logger.warn()으로 출력하는 것을 검증하는 테스트 작성 (로깅 표준 준수)
  - [ ] 3.6 [GREEN] LLMClientInitializer의 결과를 사용하여 클라이언트를 설정하여 테스트 통과
  - [ ] 3.7 [RED] determineProvider() 메서드가 요청된 provider와 초기화 상태를 확인하여 사용 가능한 provider를 반환하는 것을 검증하는 테스트 작성
  - [ ] 3.8 [GREEN] determineProvider() 메서드 구현하여 테스트 통과
  - [ ] 3.9 [RED] preferredProvider가 null이거나 클라이언트가 초기화되지 않았을 때 다른 사용 가능한 provider로 자동 전환하고, 모든 provider가 사용 불가능하면 null을 반환하는 것을 검증하는 테스트 작성
  - [ ] 3.10 [GREEN] fallback 로직 구현하여 테스트 통과
  - [ ] 3.11 [RED] extractWithLLM()에서 actualProvider가 null일 때 적절한 에러 처리와 함께 명확한 에러 메시지를 반환하는 것을 검증하는 테스트 작성
  - [ ] 3.12 [GREEN] 에러 처리 로직 구현하여 테스트 통과
  - [ ] 3.13 [REFACTOR] 코드 리팩토링(중복 제거, 가독성 향상, 성능 최적화) 수행하되 모든 기존 테스트와 새로운 테스트가 계속 통과하는지 확인

- [ ] 4.0 TripleExtractor 리팩토링
  - [ ] 4.1 [RED] initializeClients()가 LLMClientInitializer.initialize()를 호출하는 것을 검증하는 테스트 작성
  - [ ] 4.2 [GREEN] initializeClients() 메서드에서 LLMClientInitializer.initialize()를 호출하도록 변경하여 테스트 통과
  - [ ] 4.3 [RED] LLMClientInitializer 결과를 사용하여 openaiClient, geminiClient, preferredProvider를 설정하고 warnings를 logger.warn()으로 출력하는 것을 검증하는 테스트 작성 (로깅 표준 준수)
  - [ ] 4.4 [GREEN] LLMClientInitializer의 결과를 사용하여 클라이언트를 설정하여 테스트 통과
  - [ ] 4.5 [RED] determineProvider() 메서드가 요청된 provider와 초기화 상태를 확인하여 사용 가능한 provider를 반환하는 것을 검증하는 테스트 작성
  - [ ] 4.6 [GREEN] determineProvider() 메서드 구현하여 테스트 통과
  - [ ] 4.7 [RED] preferredProvider가 null이거나 클라이언트가 초기화되지 않았을 때 다른 사용 가능한 provider로 자동 전환하고, 모든 provider가 사용 불가능하면 null을 반환하는 것을 검증하는 테스트 작성
  - [ ] 4.8 [GREEN] fallback 로직 구현하여 테스트 통과
  - [ ] 4.9 [RED] extract()에서 actualProvider가 null일 때 적절한 에러 처리와 함께 명확한 에러 메시지를 반환하는 것을 검증하는 테스트 작성
  - [ ] 4.10 [GREEN] 에러 처리 로직 구현하여 테스트 통과
  - [ ] 4.11 [REFACTOR] 코드 리팩토링(중복 제거, 가독성 향상, 성능 최적화) 수행하되 모든 기존 테스트와 새로운 테스트가 계속 통과하는지 확인

- [ ] 5.0 통합 테스트 및 검증
  - [ ] 5.1 [RED] 다양한 환경 변수 조합(LLM_PROVIDER='openai', 'gemini', 'ollama', 'auto')에 대한 통합 테스트 작성 (`src/domains/relation/services/__tests__/llm-provider-integration.spec.ts`, 모킹/스텁 사용, CI/로컬에서 재현 가능)
  - [ ] 5.2 [GREEN] 모킹된 환경에서 통합 테스트 실행하여 통과 확인 (실제 API 키 불필요)
  - [ ] 5.3 [RED] API 키가 없는 시나리오에서 적절한 fallback이 발생하고 logger.warn()으로 경고 메시지가 출력되는 것을 검증하는 통합 테스트 작성 (모킹 사용)
  - [ ] 5.4 [GREEN] 모킹된 환경에서 API 키 없음 시나리오 테스트 실행하여 통과 확인
  - [ ] 5.5 [RED] 설정된 provider가 실패하는 시나리오에서 다른 provider로 자동 전환이 발생하고 logger.warn()으로 로그에 기록되는 것을 검증하는 통합 테스트 작성 (모킹 사용)
  - [ ] 5.6 [GREEN] 모킹된 환경에서 Provider 실패 시나리오 테스트 실행하여 통과 확인
  - [ ] 5.7 [REFACTOR] 전체 테스트 스위트 실행하고 코드 리팩토링 수행하되 모든 기존 테스트와 새로운 테스트가 계속 통과하는지 확인
  - [ ] 5.8 LLMClientInitializer 사용법과 환경 변수 설정 방법 문서화
