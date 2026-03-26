# Research: Recall 검색 품질 개선

**Branch**: `003-recall-sentence-query` | **Date**: 2026-03-24

## 변경 대상 파일 및 위치

### 1. recall query 파라미터 설명
- **파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`
- **위치**: 라인 405-407 (JSON Schema `query.description`)
- **현재값**: `'검색 쿼리 (type이 core 또는 vault가 아닌 경우 필수). memory_types만 제공된 경우에도 query는 필수입니다.'`

### 2. memory_injection query 파라미터 설명
- **파일**: `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts`
- **위치**:
  - 라인 18-19 (Zod schema): `z.string().describe('검색할 쿼리')`
  - 라인 34-36 (JSON Schema): `description: '검색할 쿼리'`
- **현재값**: `'검색할 쿼리'`

### 3. TF-IDF Fallback 발생 위치
- **파일**: `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts`
- **메서드**: `tryFallbackProviders()` (라인 232-256)
- **현황**: TF-IDF로 fallback 시 `result.provider = decision.selectedProvider`로 provider를 기록하지만, 검색 맥락에서 별도 경고를 출력하지 않음
- `currentProviderName` 필드로 마지막 사용 provider를 추적하고 있음

### 4. RecallResponseMetadata 현재 구조
- **파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`
- **위치**: 라인 86-97
- **기존 진단 필드**: `text_result_count?`, `vector_result_count?`, `fallback_used?`
- **추가 필요**: `embedding_provider?: string`

### 5. embedding_provider 노출 방법

**결정**: `UnifiedEmbeddingService`에 `getCurrentProviderName()` 메서드를 추가하여 마지막으로 사용된 provider를 노출한다.

- `currentProviderName` 필드는 이미 존재 (`private`)
- recall-tool이 search 완료 후 `context.services.embeddingService?.getCurrentProviderName()`으로 provider를 조회
- TF-IDF인 경우 stderr 경고 + metadata에 기록

**대안 검토**:
- `hybridSearchEngine`이 provider 정보를 반환하도록 변경: 영향 범위가 넓고 인터페이스 변경 필요 → 기각
- `EmbeddingResult.provider` 체인 전달: hybrid search 결과 구조 변경 필요 → 기각

## 테스트 전략

- **단위 테스트**: `recall-tool.spec.ts`에 TF-IDF fallback 시 경고 출력 + metadata 포함 케이스 추가
- **스키마 테스트**: `query` 파라미터 description 문자열 검증
- **통합 테스트**: 기존 테스트가 keyword 방식 쿼리로도 통과하는지 확인
