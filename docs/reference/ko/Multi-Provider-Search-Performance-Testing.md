# 다중 Provider 검색 성능 테스트 가이드

## 개요

다중 임베딩 provider 환경에서 검색 성능을 측정하고, 단일 provider 환경에서 기존 성능이 유지되는지 확인하는 테스트 가이드입니다.

## 테스트 스크립트

### 1. 다중 Provider 검색 성능 벤치마크

다중 provider 환경에서 검색 응답 시간을 측정합니다.

**실행 방법:**
```bash
npm run test:ci:core
```

전용 multi-provider benchmark runner는 제거되었습니다. 현재 회귀 확인은 core 테스트 스위트를 사용하고, 이 문서는 과거 측정 방법과 해석 기준을 보존합니다.

**측정 항목:**
- 단일 Provider 검색 성능 (각 provider별)
- 다중 Provider 병렬 검색 성능
- 응답 시간 통계 (평균, 최소, 최대, P50, P95, P99)
- 성공률

**출력 예시:**
```
🚀 다중 Provider 검색 성능 벤치마크 시작

📦 테스트 데이터 준비 중...
✅ 테스트 데이터 준비 완료 (50개 메모리, 3개 provider)

📊 벤치마크 시나리오:
  - 단일 Provider 검색: 3개 provider 각각 측정
  - 다중 Provider 병렬 검색: 3개 provider 동시 검색
  - 반복 횟수: 10회
  - 테스트 쿼리: 4개

1️⃣ 단일 Provider 검색 성능 측정
   minilm 검색 성능 측정 중...
   ✅ minilm: 평균 45.23ms (min: 32.10ms, max: 67.45ms)
   ...

2️⃣ 다중 Provider 병렬 검색 성능 측정
   쿼리: "테스트 메모리"
   ✅ 평균 응답 시간: 78.45ms
      P50: 75.20ms, P95: 95.30ms, P99: 120.50ms
      성공률: 100.0%
   ...

📈 벤치마크 결과 리포트
...
```

### 2. 단일 Provider 환경 회귀 테스트

다중 provider 검색 기능 추가 후, 단일 provider 환경에서 기존 성능이 유지되는지 확인합니다.

**실행 방법:**
```bash
npm run test:ci:core
```

전용 single-provider regression runner도 제거되었으므로 현재 core 테스트 스위트로 회귀를 확인합니다.

**검증 항목:**
- 단일 Provider 검색 성능 (평균 500ms 이하 기준)
- recall 도구 동작 확인
- 다중 Provider 감지 기능이 단일 provider 환경에서 올바르게 동작하는지 확인

**출력 예시:**
```
🧪 단일 Provider 환경 회귀 테스트 시작

1️⃣ 데이터베이스 초기화
✅ 데이터베이스 초기화 완료

2️⃣ 단일 Provider 테스트 데이터 생성
✅ 테스트 데이터 생성 완료 (20개 메모리, provider: minilm)

3️⃣ 서비스 초기화
✅ 서비스 초기화 완료

4️⃣ 단일 Provider 검색 성능 테스트
   첫 검색 결과: 10개 항목, 45.23ms
   평균 검색 시간: 48.56ms
   최대 검색 시간: 67.89ms
   ✅ 성능 기준 통과 (48.56ms <= 500ms)

5️⃣ recall 도구 동작 확인 (단일 provider 환경)
   ✅ recall 도구 정상 동작 (10개 결과)

6️⃣ 다중 Provider 감지 기능 확인 (단일 provider 환경)
   ✅ Provider 감지 정상 (1개 provider 감지)

📊 회귀 테스트 결과 리포트
================================================================================
✅ 단일 Provider 검색 성능
   평균 검색 시간 48.56ms가 기준(500ms) 이하입니다.
   성능 지표: 평균 48.56ms, 결과 20개

✅ recall 도구 동작
   recall 도구가 정상 동작합니다. (10개 결과)

✅ 다중 Provider 감지 (단일 provider 환경)
   감지된 provider 수가 올바릅니다. (1개)
================================================================================

총 3개 테스트: 3개 통과, 0개 실패

✅ 모든 회귀 테스트 통과!
```

## 성능 기준

### 단일 Provider 환경
- **검색 응답 시간**: 평균 500ms 이하
- **성공률**: 100%

### 다중 Provider 환경
- **병렬 검색 응답 시간**: 단일 provider 검색 시간의 1.5배 이하 권장
- **성공률**: 95% 이상

## 주의사항

1. **테스트 환경**: 실제 API 키가 필요한 provider(OpenAI, Gemini)를 사용하는 경우, 환경 변수 설정이 필요합니다.
2. **네트워크 지연**: 외부 API를 사용하는 provider의 경우, 네트워크 지연이 성능에 영향을 줄 수 있습니다.
3. **데이터 크기**: 테스트 데이터 크기에 따라 성능 측정 결과가 달라질 수 있습니다.

## 문제 해결

### 벤치마크 실행 실패
- 데이터베이스 초기화 확인
- 필요한 서비스가 정상적으로 초기화되었는지 확인
- 로그를 확인하여 구체적인 에러 메시지 확인

### 성능 기준 미달
- 데이터베이스 인덱스 확인
- 네트워크 상태 확인 (외부 API 사용 시)
- 시스템 리소스 확인 (CPU, 메모리)

## 추가 리소스

- [Hybrid Search Engine 소스](../../../packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts)
- [Single-provider regression suite](../../../packages/memento-core/src/test/single-provider-regression.integration.spec.ts)
