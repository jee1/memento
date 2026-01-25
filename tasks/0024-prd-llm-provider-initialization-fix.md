# PRD: LLM Provider 초기화 로직 개선 및 통일

## 1. Introduction/Overview

Memento 프로젝트에서 LLM(대규모 언어 모델)을 사용하는 여러 서비스들(`TripleExtractionService`, `LLMBasedRelationExtractor`, `TripleExtractor` 등)이 각각 독립적으로 클라이언트 초기화 로직을 구현하고 있습니다. 현재 이러한 서비스들은 `LLM_PROVIDER` 환경 변수 설정을 제대로 반영하지 못하거나, API 키가 없을 때 명확한 에러 처리나 fallback 로직이 부족한 문제가 있습니다.

**발견된 주요 문제:**
1. **초기화 실패 시 에러**: `LLM_PROVIDER='openai'`로 설정되어 있지만 `OPENAI_API_KEY`가 없을 때, `preferredProvider`는 'openai'로 설정되지만 실제 `openaiClient`는 null인 상태로 남아있어 런타임 에러 발생
2. **로직 불일치**: 각 서비스마다 초기화 로직이 약간씩 다르게 구현되어 있어 일관성 부족
3. **Fallback 미흡**: `LLM_PROVIDER`가 특정 값으로 설정되어 있을 때, 해당 provider 초기화 실패 시 다른 provider로 자동 전환하는 로직이 불완전
4. **설정 검증 부족**: 서비스 시작 시 API 키 유효성 검증 및 명확한 경고 메시지 부족

**목표**: `LLM_PROVIDER` 환경 변수 설정을 정확히 반영하고, 모든 LLM 서비스에서 일관된 초기화 로직을 사용하며, 초기화 실패 시 명확한 에러 처리와 자동 fallback을 제공하는 통일된 시스템을 구축합니다.

## 2. Goals

1. **LLM_PROVIDER 설정 정확 반영**: 환경 변수 `LLM_PROVIDER` 값에 따라 정확히 해당 provider를 우선 사용하도록 보장
2. **초기화 로직 통일**: 모든 LLM 서비스에서 동일한 초기화 로직과 fallback 전략 사용
3. **에러 방지**: 클라이언트가 초기화되지 않았을 때 명확한 에러 메시지 제공 및 사전 검증
4. **자동 Fallback**: 설정된 provider 초기화 실패 시 다른 사용 가능한 provider로 자동 전환
5. **설정 검증**: 서비스 시작 시 API 키 존재 여부 검증 및 경고
6. **로깅 개선**: 초기화 성공/실패, fallback 발생 등을 명확하게 로깅
7. **기존 기능 100% 유지**: 모든 기존 테스트 통과 및 API 호환성 유지

## 3. User Stories

### 3.1 시스템 관리자 관점

**As a** 시스템 관리자  
**I want** `LLM_PROVIDER` 환경 변수만 설정하면 해당 provider가 우선 사용되도록  
**So that** 환경 설정이 예상대로 동작합니다.

**As a** 시스템 관리자  
**I want** API 키가 없을 때 명확한 경고 메시지를 받고  
**So that** 설정 오류를 빠르게 파악하고 수정할 수 있습니다.

**As a** 시스템 관리자  
**I want** 설정된 provider가 실패해도 다른 provider로 자동 전환되도록  
**So that** 서비스가 중단되지 않고 계속 동작합니다.

### 3.2 개발자 관점

**As a** 백엔드 개발자  
**I want** 모든 LLM 서비스가 동일한 초기화 로직을 사용하도록  
**So that** 코드를 이해하고 유지보수하기 쉬워집니다.

**As a** 테스트 작성자  
**I want** 초기화 실패 시나리오를 쉽게 테스트할 수 있도록  
**So that** 다양한 환경에서의 동작을 검증할 수 있습니다.

**As a** 코드 리뷰어  
**I want** 중복된 초기화 로직이 공통 모듈로 통일되도록  
**So that** 코드 중복을 줄이고 버그 발생 가능성을 낮출 수 있습니다.

### 3.3 사용자 관점

**As a** Memento 사용자  
**I want** Triple 추출 기능이 항상 동작하도록  
**So that** 메모리 저장 시 관계 정보가 정상적으로 추출됩니다.

**As a** Memento 사용자  
**I want** API 키 설정 오류로 인한 서비스 중단이 없도록  
**So that** 안정적으로 서비스를 사용할 수 있습니다.

## 4. Functional Requirements

### 4.1 LLM Provider 초기화 공통 모듈

**FR-1**: 시스템은 `LLMClientInitializer`라는 공통 초기화 모듈을 제공해야 합니다.

**FR-2**: `LLMClientInitializer`는 다음 provider를 지원해야 합니다:
- `openai`: OpenAI API 사용
- `gemini`: Google Gemini API 사용
- `ollama`: Ollama 로컬 서버 사용
- `auto`: 사용 가능한 provider 자동 선택

**FR-3**: `LLMClientInitializer`는 provider 선택 시 다음 우선순위를 따라야 합니다:
- 최우선: 환경 변수 `LLM_PROVIDER` (프로세스 환경 변수에서 직접 읽은 값)
- 차순위: `mementoConfig.llmProvider` (환경 변수 해석 후 설정된 값, 기본값 'auto')
- 최종: 'auto' (모두 없을 경우)

**FR-4**: `LLMClientInitializer`는 초기화 결과를 다음 형식으로 반환해야 합니다:
```typescript
{
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  openaiClient: OpenAI | null;
  geminiClient: GoogleGenerativeAI | null;
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  warnings: string[];
}
```

### 4.2 Provider 선택 및 Fallback 로직

**FR-5**: `LLM_PROVIDER='openai'`로 설정된 경우:
- OpenAI 클라이언트 초기화를 먼저 시도
- 초기화 실패 시 Gemini 클라이언트 초기화 시도
- 둘 다 실패 시 `preferredProvider`는 null을 반환하고 경고 로그 출력

**FR-6**: `LLM_PROVIDER='gemini'`로 설정된 경우:
- Gemini 클라이언트 초기화를 먼저 시도
- 초기화 실패 시 OpenAI 클라이언트 초기화 시도
- 둘 다 실패 시 `preferredProvider`는 null을 반환하고 경고 로그 출력

**FR-7**: `LLM_PROVIDER='ollama'`로 설정된 경우:
- Ollama 연결 테스트를 먼저 시도
  - 연결 테스트 방법: `GET {OLLAMA_BASE_URL}/api/tags` 엔드포인트 호출
  - 타임아웃: 5초
  - 재시도: 없음 (초기화 시점에는 1회만 시도)
  - 성공 기준: HTTP 200 응답 및 JSON 파싱 성공
- 연결 실패 시 OpenAI, Gemini 순서로 fallback
- 모두 실패 시 `preferredProvider`는 null을 반환하고 경고 로그 출력

**FR-8**: `LLM_PROVIDER='auto'`로 설정된 경우 (또는 미설정):
- OpenAI -> Gemini -> Ollama 순서로 사용 가능한 첫 번째 provider 선택
- 모두 실패 시 `preferredProvider`는 null을 반환하고 경고 로그 출력

**FR-9**: Fallback이 발생한 경우, 다음 정보를 로그에 기록해야 합니다:
- 원래 설정된 provider
- 초기화 실패 사유
- 실제 사용된 provider (fallback)

### 4.3 API 키 검증 및 경고

**FR-10**: 각 provider 초기화 시도 전에 해당 API 키 존재 여부를 확인해야 합니다.

**FR-11**: API 키가 없을 때는 초기화를 시도하지 않고 null을 반환해야 합니다.

**FR-12**: `LLM_PROVIDER`가 특정 값으로 설정되어 있지만 해당 API 키가 없을 때, 다음 경고를 로그에 출력해야 합니다:
```
WARN: LLM_PROVIDER='openai'로 설정되어 있지만 OPENAI_API_KEY가 없습니다. 다른 provider로 fallback을 시도합니다.
```

**FR-13**: 모든 provider 초기화가 실패한 경우, 다음 에러를 로그에 출력해야 합니다:
```
ERROR: LLM 서비스를 사용할 수 없습니다. 최소 하나의 API 키(OPENAI_API_KEY 또는 GEMINI_API_KEY)를 설정하거나 Ollama 서버를 실행해주세요.
```

### 4.4 서비스별 통합

**FR-14**: `TripleExtractionService`는 `LLMClientInitializer`를 사용하도록 리팩토링해야 합니다.

**FR-15**: `LLMBasedRelationExtractor`는 `LLMClientInitializer`를 사용하도록 리팩토링해야 합니다.

**FR-16**: `TripleExtractor`는 `LLMClientInitializer`를 사용하도록 리팩토링해야 합니다.

**FR-17**: 각 서비스는 `LLMClientInitializer`의 결과를 사용하여 `preferredProvider`와 클라이언트를 설정해야 합니다.

**FR-18**: 각 서비스의 `extractWithLLM()` 또는 유사한 메서드는 `preferredProvider`가 null인 경우, `TripleExtractionResult`의 `failureReason`을 'llm_unavailable'로 설정하고 명확한 에러 메시지를 반환해야 합니다.

**FR-19**: 각 서비스의 `extractWithLLM()` 또는 유사한 메서드는 `actualProvider`를 결정할 때, 중앙 fallback 결정 루틴을 사용해야 합니다. 이 루틴은:
- 클라이언트 초기화 상태를 확인
- 초기화되지 않은 경우 사용 가능한 다른 provider로 자동 전환
- 모든 provider가 사용 불가능한 경우 null 반환
- 재진입 방지: 이미 시도한 provider는 다시 시도하지 않음

**FR-20**: 중앙 fallback 결정 루틴은 다음 순서로 provider를 선택해야 합니다:
1. 요청된 provider (또는 preferredProvider)
2. 사용 가능한 다른 provider (OpenAI -> Gemini -> Ollama 순서)
3. null (모두 사용 불가능한 경우)

### 4.5 에러 처리

**FR-21**: `extractWithLLM()` 또는 유사한 메서드는 중앙 fallback 결정 루틴을 사용하여 `actualProvider`를 결정해야 합니다. 이 루틴은:
- 무한 재귀 방지: 이미 시도한 provider 목록을 추적
- 단일 경로 처리: 한 번의 호출에서 최종 provider 결정
- 클라이언트 초기화 상태 확인: null 체크 후 fallback

**FR-22**: 중앙 fallback 결정 루틴의 동작:
- 입력: 요청된 provider, 초기화된 클라이언트 상태
- 처리: 사용 가능한 provider를 우선순위에 따라 선택
- 출력: 사용 가능한 provider 또는 null
- 재진입 방지: 동일한 provider를 반복 시도하지 않음

**FR-23**: 모든 provider가 실패한 경우 (중앙 fallback 루틴이 null 반환), `TripleExtractionResult`의 `failureReason`을 'llm_unavailable'로 설정해야 합니다.

**FR-24**: 에러 메시지는 사용자에게 해결 방법을 제시해야 합니다:
```
"LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요."
```

### 4.6 로깅

**FR-25**: 초기화 성공 시 다음 정보를 로그에 기록해야 합니다:
- 사용된 provider
- 초기화된 클라이언트 목록

**FR-26**: 초기화 실패 시 다음 정보를 로그에 기록해야 합니다:
- 실패한 provider
- 실패 사유
- Fallback 시도 여부

**FR-27**: Fallback 발생 시 다음 정보를 로그에 기록해야 합니다:
- 원래 설정된 provider
- Fallback된 provider
- Fallback 사유

## 5. Non-Goals (Out of Scope)

1. **새로운 Provider 추가**: 이번 작업에서는 기존 provider(OpenAI, Gemini, Ollama)만 지원하며, 새로운 provider 추가는 범위에 포함되지 않습니다.

2. **동적 Provider 전환**: 런타임에 provider를 동적으로 변경하는 기능은 포함되지 않습니다. 초기화 시점에만 결정됩니다.

3. **API 키 유효성 검증**: API 키의 실제 유효성(인증 성공 여부)을 검증하는 것은 포함되지 않습니다. 존재 여부만 확인합니다.

4. **비용 최적화**: Provider 선택 시 비용을 고려하는 로직은 포함되지 않습니다.

5. **사용량 모니터링**: Provider별 사용량 추적 기능은 포함되지 않습니다.

6. **Embedding Service 통합**: 이번 작업에서는 LLM 서비스만 대상으로 하며, Embedding Service는 별도 작업으로 분리됩니다.

## 6. Design Considerations

### 6.1 공통 모듈 설계

**제안 구조:**
```
src/shared/services/llm-client-initializer.ts
```

**참고**: 프로젝트 구조를 확인한 결과, `src/shared/` 디렉토리가 존재하므로 이 경로를 사용합니다. 만약 `src/services/`를 사용해야 한다면 구현 단계에서 확인 및 조정합니다.

**주요 인터페이스:**
```typescript
export interface LLMClientInitializationResult {
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  openaiClient: OpenAI | null;
  geminiClient: GoogleGenerativeAI | null;
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  warnings: string[];
}

export class LLMClientInitializer {
  static initialize(): LLMClientInitializationResult;
  static validateApiKeys(): { openai: boolean; gemini: boolean };
}
```

### 6.2 기존 서비스 통합

각 서비스는 다음과 같이 리팩토링됩니다:

**Before:**
```typescript
private initializeClients(): 'openai' | 'gemini' | 'ollama' | null {
  // 각 서비스마다 다른 로직
}
```

**After:**
```typescript
private initializeClients(): 'openai' | 'gemini' | 'ollama' | null {
  const result = LLMClientInitializer.initialize();
  this.openaiClient = result.openaiClient;
  this.geminiClient = result.geminiClient;
  this.preferredProvider = result.preferredProvider;
  
  // 경고 로그 출력
  result.warnings.forEach(warning => logger.warn(warning));
  
  return result.preferredProvider;
}
```

### 6.3 Fallback 로직 개선

`extractWithLLM()` 메서드에서 중앙 fallback 결정 루틴 사용:

```typescript
private async extractWithLLM(...) {
  // 중앙 fallback 결정 루틴 사용
  const actualProvider = this.determineProvider(provider);
  
  // 모든 provider가 사용 불가능한 경우
  if (!actualProvider) {
    const result = this.createFailureResult('llm_unavailable', 
      'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.');
    return { result, rawLLMOutput: '' };
  }
  
  // ... 나머지 로직
}

/**
 * 중앙 fallback 결정 루틴
 * 재진입 방지 및 단일 경로 처리 보장
 */
private determineProvider(
  requestedProvider: 'openai' | 'gemini' | 'ollama' | 'auto'
): 'openai' | 'gemini' | 'ollama' | null {
  const triedProviders = new Set<'openai' | 'gemini' | 'ollama'>();
  
  // 1. 요청된 provider 결정
  let candidate = requestedProvider === 'auto' 
    ? (this.preferredProvider || 'openai')
    : requestedProvider;
  
  // 2. 사용 가능한 provider 찾기 (최대 3회 시도)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (triedProviders.has(candidate)) {
      break; // 이미 시도한 provider는 건너뛰기
    }
    
    triedProviders.add(candidate);
    
    // 클라이언트 초기화 상태 확인
    if (candidate === 'openai' && this.openaiClient) {
      return 'openai';
    }
    if (candidate === 'gemini' && this.geminiClient) {
      return 'gemini';
    }
    if (candidate === 'ollama') {
      // Ollama는 연결 테스트 필요 (초기화 시점에 이미 확인됨)
      // 여기서는 preferredProvider에 포함되어 있으면 사용 가능한 것으로 간주
      if (this.preferredProvider === 'ollama') {
        return 'ollama';
      }
    }
    
    // Fallback: 다음 사용 가능한 provider 선택
    if (candidate === 'openai' && !triedProviders.has('gemini')) {
      candidate = 'gemini';
    } else if (candidate === 'gemini' && !triedProviders.has('openai')) {
      candidate = 'openai';
    } else {
      break; // 더 이상 시도할 provider 없음
    }
  }
  
  // 모든 provider가 사용 불가능
  return null;
}
```

## 7. Technical Considerations

### 7.1 기존 코드 호환성

- 모든 기존 테스트가 통과해야 합니다
- 기존 API 인터페이스는 변경되지 않습니다
- 환경 변수 설정 방식은 기존과 동일합니다

### 7.2 의존성

- `openai` 패키지: 기존과 동일
- `@google/generative-ai` 패키지: 기존과 동일
- 추가 의존성 없음

### 7.3 성능

- 초기화는 서비스 시작 시 한 번만 수행되므로 성능 영향 없음
- Fallback 로직은 런타임에 최소한의 오버헤드만 발생

### 7.4 테스트

- 단위 테스트: `LLMClientInitializer`의 각 시나리오 테스트
- 통합 테스트: 각 서비스의 초기화 및 fallback 동작 테스트
- E2E 테스트: 실제 API 키 없이 서비스 시작 시나리오 테스트

### 7.5 마이그레이션

- 기존 서비스들은 점진적으로 리팩토링
- 한 번에 하나의 서비스씩 변경하여 리스크 최소화

## 8. Success Metrics

1. **에러 감소**: "OpenAI 클라이언트가 초기화되지 않았습니다" 에러 발생 횟수 0
2. **설정 준수**: `LLM_PROVIDER` 환경 변수 설정이 100% 정확히 반영됨
3. **Fallback 성공률**: 설정된 provider 실패 시 다른 provider로 자동 전환 성공률 100%
4. **코드 일관성**: 모든 LLM 서비스가 동일한 초기화 로직 사용
5. **테스트 커버리지**: 새로운 `LLMClientInitializer` 모듈 테스트 커버리지 90% 이상
6. **로깅 품질**: 초기화 실패 및 fallback 발생 시 명확한 로그 메시지 제공

## 9. Open Questions

1. **Ollama 지원 범위**: Ollama 연결 실패 시 fallback 로직이 현재 구현되어 있는지 확인 필요
2. **에러 복구**: 런타임에 API 키가 추가되었을 때 동적으로 재초기화하는 기능이 필요한가?
3. **로깅 레벨**: 초기화 실패 및 fallback 로그의 적절한 로그 레벨은 무엇인가? (WARN vs ERROR)
4. **설정 검증 시점**: 서비스 시작 시점에 모든 API 키를 검증할 것인가, 아니면 사용 시점에 검증할 것인가?
5. **다중 Provider 동시 사용**: 향후 여러 provider를 동시에 사용하는 기능이 필요한가?

## 10. Implementation Plan

### Phase 1: 공통 모듈 생성
1. `LLMClientInitializer` 클래스 생성
2. 초기화 로직 구현
3. 단위 테스트 작성

### Phase 2: TripleExtractionService 리팩토링
1. `LLMClientInitializer` 통합
2. Fallback 로직 개선
3. 테스트 업데이트

### Phase 3: 다른 서비스 리팩토링
1. `LLMBasedRelationExtractor` 리팩토링
2. `TripleExtractor` 리팩토링
3. 각 서비스 테스트 업데이트

### Phase 4: 통합 테스트 및 검증
1. E2E 테스트 작성
2. 다양한 환경 변수 조합 테스트
3. 문서 업데이트
