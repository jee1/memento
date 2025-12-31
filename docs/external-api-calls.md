# 외부 API 호출 목록

이 문서는 코드베이스에서 외부 API 호출을 식별하고 우선순위를 정한 목록입니다.

## 검색 기준

다음 패턴을 검색하여 외부 API 호출을 식별했습니다:
- `fetch()` - 표준 fetch API
- `axios.*` - Axios HTTP 클라이언트
- `http.request()`, `https.request()` - Node.js HTTP 모듈
- `new OpenAI()` - OpenAI SDK
- `new GoogleGenerativeAI()` - Google Gemini SDK
- OpenAI/Gemini SDK 메서드 호출 (`.completions.create()`, `.getGenerativeModel()`, `.generateContent()` 등)

## 우선순위 기준

우선순위는 다음 기준으로 계산됩니다:
- 호출 수 × 10
- SDK/Client 타입 호출 × 5 (추가 가중치)

## 핵심 모듈 외부 API 호출 목록

다음은 `src/domains/embedding/` 및 `src/domains/relation/` 디렉토리의 외부 API 호출 목록입니다.

### 우선순위 높음 (즉시 전환 권장)

1. **src/domains/relation/services/llm-based-relation-extractor.ts** (우선순위: 135)
   - 호출 수: 10개
   - 타입: fetch, sdk
   - 주요 호출:
     - `fetch()` - Ollama API 호출 (3회)
     - `new OpenAI()` - OpenAI 클라이언트 초기화
     - `new GoogleGenerativeAI()` - Gemini 클라이언트 초기화
     - `.completions.create()` - OpenAI API 호출
     - `.getGenerativeModel()`, `.generateContent()` - Gemini API 호출

2. **src/domains/embedding/services/embedding-service.ts** (우선순위: 35)
   - 호출 수: 3개
   - 타입: sdk
   - 주요 호출:
     - `new OpenAI()` - OpenAI 클라이언트 초기화
     - OpenAI SDK import

3. **src/domains/embedding/services/openai-embedding-service.ts** (우선순위: 35)
   - 호출 수: 3개
   - 타입: sdk
   - 주요 호출:
     - `new OpenAI()` - OpenAI 클라이언트 초기화
     - OpenAI SDK import

4. **src/domains/embedding/services/gemini-embedding-service.ts** (우선순위: 35)
   - 호출 수: 3개
   - 타입: sdk
   - 주요 호출:
     - `new GoogleGenerativeAI()` - Gemini 클라이언트 초기화
     - Gemini SDK import

## 전체 외부 API 호출 통계

전체 코드베이스에서 외부 API 호출을 검색한 결과:
- 총 파일 수: [스크립트 실행 결과 참조]
- 총 호출 수: [스크립트 실행 결과 참조]

## 전환 계획

1. **Phase 1**: 임베딩 제공자 (2.4)
   - `openai-embedding-service.ts`
   - `gemini-embedding-service.ts`
   - `embedding-service.ts`

2. **Phase 2**: 관계 추출 서비스 (2.5)
   - `llm-based-relation-extractor.ts`

3. **Phase 3**: 기타 서비스 (2.5)
   - 기타 외부 API 호출 서비스

## 사용 방법

외부 API 호출 목록을 업데이트하려면:

```bash
# 핵심 모듈만 검색
npx tsx scripts/find-external-api-calls.ts --core-only --format=json > docs/external-api-calls.json

# 전체 검색
npx tsx scripts/find-external-api-calls.ts --format=json > docs/external-api-calls-full.json
```

## 참고

- 이 목록은 `scripts/find-external-api-calls.ts` 스크립트로 자동 생성됩니다.
- 우선순위는 호출 빈도와 타입을 기반으로 계산됩니다.
- 실제 전환 작업은 우선순위 순으로 진행됩니다.

