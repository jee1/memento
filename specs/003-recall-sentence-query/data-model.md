# Data Model Changes: Recall 검색 품질 개선

**Branch**: `003-recall-sentence-query` | **Date**: 2026-03-24

## 변경되는 인터페이스

### RecallResponseMetadata (추가 필드)

```typescript
// packages/memento-core/src/domains/memory/tools/recall-tool.ts

export interface RecallResponseMetadata {
  anchor_set: AnchorSetMetadata | null;
  anchor_set_error?: boolean;
  anchor_set_skipped?: boolean;
  anchor_set_skipped_reason?: string;
  text_result_count?: number;
  vector_result_count?: number;
  fallback_used?: boolean;
  /** 실제 사용된 임베딩 제공자 (진단용). tfidf일 경우 품질 저하 가능성 있음 */
  embedding_provider?: string;   // ← 신규 추가
  [key: string]: AnchorSetMetadata | null | boolean | string | number | undefined;
}
```

**변경 방식**: optional 필드 추가 → 하위 호환 유지

---

## 추가되는 메서드

### UnifiedEmbeddingService.getCurrentProviderName()

```typescript
// packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts

/**
 * 마지막으로 사용된 임베딩 제공자 이름 반환 (진단용)
 */
getCurrentProviderName(): EmbeddingProvider | null {
  return this.currentProviderName;
}
```

**목적**: recall-tool이 search 완료 후 어떤 provider가 사용되었는지 확인하기 위함.

---

## DB 스키마 변경 없음

이 기능은 도구 설명 문자열 변경, 진단 메타데이터 추가, 경고 출력이 전부이므로 DB 스키마 변경이 없습니다.
