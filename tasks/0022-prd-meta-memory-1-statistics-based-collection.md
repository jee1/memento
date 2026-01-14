# PRD: Meta-Memory(1) - 통계 기반 메타 메모리 수집 (LLM 미사용)

## 소개/개요

Meta-Memory(1)는 Memento가 **자신의 기억 사용 결과를 관찰하고 기록**할 수 있도록 하는 핵심 기능입니다. 이 기능은 recall 성공/실패, confidence 등의 **통계 지표를 메타 메모리로 수집**하여, Memento가 "내가 무엇을 잘 기억하고 있고, 무엇을 잘 못하고 있는가?"를 판단하기 위한 **기초 관찰 계층**을 제공합니다.

본 단계에서는 **LLM 호출 없이 순수 통계 기반**으로만 동작하며, 향후 Meta-Memory(2) 패턴 분석 및 Meta-Memory(3) LLM 기반 자기 성찰 기능의 기반이 됩니다.

### 해결하는 문제

현재 Memento는 기억을 저장하고 검색하는 역할에 충실하지만, 다음에 대한 **자기 인식(self-awareness)**이 없습니다:

- 어떤 기억이 자주 호출되는지
- 어떤 검색이 실패하는지
- 시스템이 제공한 결과의 신뢰도는 어떠한지
- 어떤 기억 영역이 취약한지

Meta-Memory(1)는 이러한 관찰 데이터를 수집하여 향후 기억 품질 평가, 자동 정리/압축(consolidation), 성찰(reflection) 및 전략 변경의 기초를 마련합니다.

## 목표

1. **관찰 데이터 수집**: recall 성공/실패, confidence 점수, 호출 빈도 등의 통계 지표를 메타 메모리로 수집
2. **낮은 비용**: LLM 호출 없이 순수 통계 기반으로 동작하여 비용 최소화
3. **실시간성**: recall 호출 시 즉시 통계 업데이트 (Write-through + Debounce 방식)
4. **확장성**: 향후 Meta-Memory(2), (3) 단계와 자연스럽게 확장 가능한 구조
5. **성능 영향 최소화**: 통계 수집이 recall 성능에 미치는 영향 최소화

## 사용자 스토리

### 사용자 스토리 1: 개발자 관점
**개발자로서**, Memento의 기억 사용 패턴을 파악하여 시스템 최적화를 하고 싶습니다. 특정 주제를 반복해서 검색할 때 recall_count와 성공률이 누적되어, 어떤 기억이 자주 사용되는지 확인할 수 있어야 합니다.

### 사용자 스토리 2: 운영자 관점
**운영자로서**, 검색 결과가 자주 실패하는 메모리 영역을 파악하여 시스템 품질을 개선하고 싶습니다. failure_count 기반으로 취약 기억을 식별하고, confidence 평균이 낮은 기억을 탐지하여 향후 정리/보강 대상 후보로 활용할 수 있어야 합니다.

### 사용자 스토리 3: AI Agent 관점
**AI Agent로서**, 내가 제공한 검색 결과의 신뢰도를 파악하여 더 나은 결과를 제공하고 싶습니다. recall 결과와 함께 메타 정보(성공 여부, confidence 점수)를 받아서, 결과의 품질을 판단하고 필요시 재검색을 수행할 수 있어야 합니다.

## 기능 요구사항

### 1. 메타 메모리 데이터 구조

#### 1.1 데이터베이스 스키마

**테이블명**: `meta_memory_stats`

```sql
CREATE TABLE IF NOT EXISTS meta_memory_stats (
  memory_id TEXT PRIMARY KEY,
  recall_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_confidence REAL DEFAULT 0.0,
  last_recalled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);
```

**인덱스**:
- `idx_meta_memory_stats_recall_count` (recall_count DESC)
- `idx_meta_memory_stats_avg_confidence` (avg_confidence DESC)
- `idx_meta_memory_stats_last_recalled_at` (last_recalled_at DESC)
- `idx_meta_memory_stats_failure_count` (failure_count DESC)

**트리거**:
- `updated_at` 자동 업데이트 트리거

#### 1.2 데이터 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `memory_id` | TEXT | 기억 ID (memory_item.id 참조) |
| `recall_count` | INTEGER | 총 회상 횟수 |
| `success_count` | INTEGER | 성공한 회상 횟수 |
| `failure_count` | INTEGER | 실패한 회상 횟수 |
| `avg_confidence` | REAL | 평균 신뢰도 점수 (0.0 ~ 1.0) |
| `last_recalled_at` | TIMESTAMP | 마지막 회상 시점 |
| `created_at` | TIMESTAMP | 생성 시점 |
| `updated_at` | TIMESTAMP | 마지막 업데이트 시점 |

### 2. 성공/실패 판정 기준

#### 2.1 판정 단위

**중요**: 성공/실패 판정은 **검색 결과 전체가 아닌 각 메모리 항목(memory_id) 단위**로 수행됩니다. 각 메모리 항목이 recall 결과에 포함되었을 때 해당 항목의 통계를 업데이트합니다.

#### 2.2 기본 판정 기준 (우선순위 순)

1. **결과 없음 판정 (A)**: 검색 결과가 0개인 경우 → **전체 검색 실패** (개별 memory_id 통계 업데이트 없음)
2. **항목별 점수 기준 판정 (B)**: 각 검색 결과 항목의 `final_score`가 0.5 이상인 경우 → **해당 항목 성공**, 미만인 경우 → **해당 항목 실패**

#### 2.3 판정 로직

```typescript
/**
 * 검색 결과 전체에 대한 성공/실패 판정
 * @param searchResult 검색 결과
 * @returns 전체 검색이 성공했는지 여부 (결과가 0개면 false)
 */
function hasSearchResults(searchResult: SearchResult): boolean {
  return searchResult.items.length > 0;
}

/**
 * 개별 메모리 항목에 대한 성공/실패 판정
 * @param item 검색 결과 항목 (final_score 포함)
 * @returns 해당 항목이 성공했는지 여부
 */
function isItemSuccess(item: RecallResultItem): boolean {
  // final_score가 0.5 이상이면 성공
  const finalScore = item.final_score || 0;
  return finalScore >= 0.5;
}

/**
 * 검색 결과를 기반으로 각 메모리 항목의 통계 업데이트
 * @param searchResult 검색 결과
 * @returns 각 memory_id별 성공/실패 정보
 */
function determineItemStats(searchResult: SearchResult): Map<string, { success: boolean; confidence: number }> {
  const stats = new Map<string, { success: boolean; confidence: number }>();
  
  // 결과가 없으면 빈 Map 반환 (통계 업데이트 없음)
  if (searchResult.items.length === 0) {
    return stats;
  }
  
  // 각 항목별로 판정
  for (const item of searchResult.items) {
    const memoryId = item.memory_id || item.id;
    if (!memoryId) continue;
    
    const success = isItemSuccess(item);
    const confidence = calculateConfidence(item);
    
    stats.set(memoryId, { success, confidence });
  }
  
  return stats;
}
```

#### 2.4 특수 케이스 처리

- **검색 결과 0개**: 어떤 memory_id의 통계도 업데이트하지 않음 (전체 검색 실패로 기록하지 않음)
- **final_score 없음**: `final_score`가 없는 경우 기본값 0.0으로 처리하여 실패로 판정
- **중복 항목**: 같은 memory_id가 여러 번 검색 결과에 포함된 경우, 각각 별도로 통계 업데이트 (recall_count는 각각 증가)

### 3. Confidence 점수 계산

#### 3.1 계산 공식

Confidence 점수는 다음 공식을 사용하여 계산합니다:

```
confidence = 0.6 * final_score + 0.3 * consolidation_score + 0.1 * vector_score
```

**가중치 설명**:
- `final_score` (60%): 검색 랭킹 최종 점수 (가장 중요) - `finalScore` 필드 사용
- `consolidation_score` (30%): 기억 통합 점수 - `consolidation_score` 필드 사용
- `vector_score` (10%): 벡터 유사도 점수 - `vectorScore` 필드 사용 (relevance 역할)

#### 3.2 필드명 매핑

검색 결과 항목(`RecallResultItem` 또는 `HybridSearchResult`)의 실제 필드명:
- `final_score`: `finalScore` (camelCase) 또는 `final_score` (snake_case) - 둘 다 지원
- `consolidation_score`: `consolidation_score` (snake_case, 선택적 필드)
- `vector_score`: `vectorScore` (camelCase) - 벡터 검색 유사도

#### 3.3 점수 정규화

모든 점수는 0.0 ~ 1.0 범위로 정규화되어야 합니다. 점수가 없는 경우 0.0으로 처리합니다.

```typescript
/**
 * 검색 결과 항목에서 confidence 점수 계산
 * @param item 검색 결과 항목 (HybridSearchResult 또는 RecallResultItem)
 * @returns confidence 점수 (0.0 ~ 1.0)
 */
function calculateConfidence(item: any): number {
  // finalScore 또는 final_score 지원 (둘 다 확인)
  const finalScore = item.finalScore || item.final_score || 0;
  
  // consolidation_score는 선택적 필드
  const consolidationScore = item.consolidation_score || 0;
  
  // vectorScore는 벡터 유사도 (relevance 역할)
  const vectorScore = item.vectorScore || 0;
  
  return (
    0.6 * finalScore +
    0.3 * consolidationScore +
    0.1 * vectorScore
  );
}
```

#### 3.4 평균 Confidence 업데이트

각 recall 호출 시, 반환된 모든 메모리 항목의 confidence 점수를 계산하고, `avg_confidence`를 업데이트합니다:

```typescript
/**
 * 평균 confidence 점수 업데이트 (누적 평균 계산)
 * @param memoryId 메모리 ID
 * @param newConfidence 새로운 confidence 점수
 * @param currentStats 현재 통계 정보
 * @returns 업데이트된 평균 confidence 점수
 */
function updateAvgConfidence(
  memoryId: string,
  newConfidence: number,
  currentStats: MetaMemoryStats
): number {
  const totalConfidence = currentStats.avg_confidence * currentStats.recall_count;
  const newTotalConfidence = totalConfidence + newConfidence;
  const newRecallCount = currentStats.recall_count + 1;
  
  return newTotalConfidence / newRecallCount;
}
```

### 4. 메타 통계 업데이트 방식

#### 4.1 Write-through + Debounce 방식

**기본 동작**:
- recall 호출 시 즉시 통계 업데이트 (Write-through)
- 짧은 시간 내 연속된 recall 호출은 Debounce하여 묶어서 처리

**Debounce 설정**:
- Debounce 시간: 100ms
- 같은 memory_id에 대한 연속 업데이트는 마지막 업데이트만 실행

#### 4.2 업데이트 흐름

```
recall 호출
  ↓
검색 결과 생성
  ↓
성공/실패 판정
  ↓
Confidence 점수 계산
  ↓
Debounce 큐에 추가
  ↓
100ms 후 배치 업데이트 실행
  ↓
데이터베이스 업데이트
```

#### 4.3 성능 최적화

- **기본**: 실시간 업데이트 (Write-through)
- **부하 감지**: 시스템 부하가 높을 때 자동으로 배치 모드로 전환
- **배치 크기**: 최대 50개 항목씩 묶어서 업데이트
- **비동기 처리**: 통계 업데이트는 recall 응답을 블로킹하지 않음

### 5. 메타 통계 조회 방법

#### 5.1 MCP 도구 제공

**도구명**: `get_meta_memory_stats`

**파라미터**:
```typescript
interface GetMetaMemoryStatsParams {
  memory_id?: string;        // 특정 기억 ID (선택적)
  memory_ids?: string[];   // 여러 기억 ID (선택적)
  min_recall_count?: number; // 최소 recall_count 필터
  min_confidence?: number;   // 최소 avg_confidence 필터
  limit?: number;            // 결과 제한 (기본값: 100)
}
```

**응답**:
```typescript
interface MetaMemoryStatsResult {
  items: MetaMemoryStats[];
  total_count: number;
}
```

#### 5.2 Recall 결과에 메타 정보 포함

recall 도구의 응답에 `meta_stats` 필드를 추가합니다. `RecallParams`에 이미 존재하는 `include_metadata` 파라미터를 활용합니다.

**기존 API 확장**:
- `RecallParams.include_metadata` (기존 파라미터, 기본값: `false`)
- `RecallResponse`에 `meta_stats` 필드 추가

```typescript
// 기존 RecallResponse 인터페이스 확장
interface RecallResponse {
  items: RecallResultItem[];
  total_count: number;
  query_time: number;
  search_type: string;
  metadata?: RecallResponseMetadata;
  meta_stats?: {  // 새로 추가되는 필드
    [memory_id: string]: {
      recall_count: number;
      success_count: number;
      failure_count: number;
      avg_confidence: number;
      last_recalled_at: string;  // ISO 8601 형식 (예: "2024-01-01T00:00:00.000Z")
    };
  };
  [key: string]: any;
}
```

**포함 조건**:
- recall 결과에 포함된 메모리 항목의 메타 통계만 포함
- `include_metadata` 파라미터가 `true`일 때만 포함 (기본값: `false`)
- `last_recalled_at`는 ISO 8601 형식 문자열로 반환 (예: `"2024-01-01T00:00:00.000Z"`)

**사용 예시**:
```typescript
// include_metadata=true로 호출
const result = await client.callTool('recall', {
  query: 'TypeScript',
  include_metadata: true  // 메타 통계 포함
});

// result.meta_stats에 각 메모리 항목의 통계 정보 포함
if (result.meta_stats) {
  const stats = result.meta_stats['mem_12345'];
  console.log(`Recall count: ${stats.recall_count}`);
  console.log(`Avg confidence: ${stats.avg_confidence}`);
  console.log(`Last recalled: ${stats.last_recalled_at}`);  // ISO 8601 형식
}
```

### 6. 데이터 보존 정책

#### 6.1 기본 정책

- **영구 보존**: 메타 통계는 메모리가 삭제될 때까지 영구 보존됩니다.
- **CASCADE 삭제**: `memory_item`이 삭제되면 해당 `meta_memory_stats` 레코드도 자동 삭제됩니다.
- **데이터 정합성**: 메모리와 메타 통계의 일관성을 보장합니다.

#### 6.2 프라이버시 고려

- 메모리 삭제 시 메타 통계도 함께 삭제하여 프라이버시 우려를 최소화합니다.
- 메타 통계는 메모리 내용을 포함하지 않으며, 통계 수치만 저장합니다.

### 7. Recall Tool 통합

#### 7.1 통합 지점

`RecallTool.handle()` 메서드 내에서 다음 시점에 메타 통계를 수집합니다:

1. **검색 결과 생성 후**: 성공/실패 판정 및 confidence 계산
2. **결과 반환 전**: 메타 통계 업데이트 및 결과에 메타 정보 포함

#### 7.2 통합 로직

```typescript
// RecallTool.handle() 내부
async handle(params: RecallParams, context: ToolContext): Promise<ToolResult> {
  // ... 기존 검색 로직 ...
  
  const searchResult = await this.performSearch(...);
  const { include_metadata } = params;  // 기존 파라미터 사용
  
  // 메타 통계 수집 (검색 결과가 있을 때만)
  if (context.services.metaMemoryService && searchResult.items.length > 0) {
    // 각 메모리 항목별로 성공/실패 판정 및 통계 업데이트
    await this.collectMetaMemoryStats(
      searchResult.items,  // 각 항목별로 처리
      context.services.metaMemoryService,
      context.services.writeCoalescingManager
    );
  }
  
  // 결과에 메타 정보 포함 (선택적)
  if (include_metadata && context.services.metaMemoryService) {
    const memoryIds = searchResult.items
      .map(item => item.memory_id || item.id)
      .filter((id): id is string => !!id);
    
    const metaStats = await this.getMetaStatsForItems(
      memoryIds,
      context.services.metaMemoryService
    );
    
    // RecallResponse에 meta_stats 추가
    if (metaStats && Object.keys(metaStats).length > 0) {
      searchResult.meta_stats = metaStats;
    }
  }
  
  return searchResult;
}

/**
 * 각 메모리 항목별로 메타 통계 수집
 */
private async collectMetaMemoryStats(
  items: RecallResultItem[],
  metaMemoryService: MetaMemoryService,
  writeCoalescingManager: WriteCoalescingManager
): Promise<void> {
  for (const item of items) {
    const memoryId = item.memory_id || item.id;
    if (!memoryId) continue;
    
    // 성공/실패 판정
    const success = isItemSuccess(item);
    const confidence = calculateConfidence(item);
    
    // 통계 업데이트 (Debounce 적용)
    await metaMemoryService.recordRecall(
      memoryId,
      {
        success,
        confidence,
        lastRecalledAt: new Date()
      },
      writeCoalescingManager
    );
  }
}
```

## 비목표 (범위 외)

다음 기능들은 본 단계의 범위에 포함되지 않습니다:

1. **LLM 기반 분석**: LLM을 사용한 패턴 분석 및 해석 (Meta-Memory(2)에서 구현)
2. **자동 정리/압축**: 통계 기반 자동 기억 정리 기능 (후속 단계에서 구현)
3. **성찰(reflection) 기능**: 통계를 바탕으로 한 전략 변경 (Meta-Memory(3)에서 구현)
4. **이벤트 로그**: 개별 recall 이벤트의 상세 로그 저장 (Level 2에서 선택적 구현)
5. **실시간 알림**: 통계 임계값 초과 시 알림 기능 (별도 기능으로 구현)
6. **시각화 대시보드**: 메타 통계 시각화 UI (별도 기능으로 구현)

## 디자인 고려사항

### 데이터베이스 설계

- **집계 중심**: 개별 이벤트 로그가 아닌 집계 통계만 저장하여 저장 공간 최소화
- **인덱스 최적화**: 자주 조회되는 필드(recall_count, avg_confidence)에 인덱스 생성
- **CASCADE 삭제**: 메모리 삭제 시 자동 정리로 데이터 정합성 보장

### 성능 고려사항

- **비동기 처리**: 통계 업데이트는 recall 응답을 블로킹하지 않음
- **Debounce**: 연속 호출 최적화로 데이터베이스 부하 감소
- **배치 업데이트**: 부하 상황에서 자동 전환으로 시스템 안정성 확보

### 확장성 고려사항

- **서비스 분리**: `MetaMemoryService`를 독립 서비스로 구현하여 향후 확장 용이
- **인터페이스 설계**: 향후 다른 데이터 소스(이벤트 로그 등)와 통합 가능한 구조
- **마이그레이션**: 스키마 변경 시 마이그레이션 스크립트 제공

## 기술적 고려사항

### 구현 파일 구조

**참고**: 저장소 가이드라인에 따라 다음 구조를 따릅니다:
- `src/services/`: 비즈니스 로직 서비스
- `src/algorithms/`: 알고리즘 구현
- `src/utils/`: 유틸리티 함수
- `src/types/`: 타입 정의
- `src/infrastructure/database/`: 데이터베이스 관련

```
src/
  services/
    meta-memory-service.ts              # 메타 메모리 통계 수집 서비스
    meta-memory-service.spec.ts         # 단위 테스트
  domains/
    monitoring/
      tools/
        get-meta-memory-stats-tool.ts   # MCP 도구
        get-meta-memory-stats-tool.spec.ts
  infrastructure/
    database/
      database/
        migration/
          migrations/
            011-meta-memory-stats-schema.sql  # 마이그레이션 스크립트
  domains/
    memory/
      tools/
        recall-tool.ts                  # Recall Tool (수정)
  shared/
    types/
      index.ts                          # MetaMemoryStats 타입 정의 추가
```

### 의존성

- **기존 서비스**: `WriteCoalescingManager` (Debounce 처리)
- **데이터베이스**: SQLite (M1 단계)
- **검색 엔진**: `HybridSearchEngine` (finalScore, consolidation_score, vectorScore 제공)
- **타입 정의**: `RecallResultItem`, `HybridSearchResult` (검색 결과 타입)

### 통합 지점

1. **RecallTool**: 메타 통계 수집 로직 통합 (`src/domains/memory/tools/recall-tool.ts`)
2. **ServerServices**: `MetaMemoryService` 초기화 및 주입 (`src/server/bootstrap.ts`)
3. **ToolContext**: `metaMemoryService` 제공 (`src/shared/types/index.ts`의 `ServerServices` 인터페이스)
4. **Tools Registry**: `get_meta_memory_stats` 도구 등록 (`src/tools/index.ts`)
5. **타입 정의**: `MetaMemoryStats` 인터페이스 추가 (`src/shared/types/index.ts`)

### 에러 처리

- **통계 수집 실패**: recall 성공 여부에 영향 없음 (로깅만 수행)
- **데이터베이스 오류**: 재시도 로직 적용 (최대 3회)
- **점수 계산 오류**: 기본값(0.0) 사용하여 계속 진행

## 성공 지표

### 정량적 지표

1. **통계 수집 정확도**: recall 호출 대비 통계 업데이트 성공률 ≥ 99%
2. **성능 영향**: recall 응답 시간 증가 ≤ 10ms (평균)
3. **데이터 정합성**: 메모리 삭제 시 메타 통계 자동 삭제 성공률 100%
4. **저장 공간**: 메타 통계 테이블 크기가 전체 데이터베이스의 5% 이하

### 정성적 지표

1. **사용성**: 개발자가 메타 통계를 쉽게 조회하고 활용할 수 있음
2. **확장성**: 향후 Meta-Memory(2), (3) 단계와 자연스럽게 통합 가능
3. **안정성**: 통계 수집이 시스템 안정성에 부정적 영향 없음

## 열린 질문

1. **Debounce 시간 조정**: 100ms가 최적인지, 실제 사용 패턴에 따라 조정 필요 여부
2. **Confidence 가중치**: 현재 가중치(0.6, 0.3, 0.1)가 최적인지, 실제 데이터로 검증 필요
3. **성공/실패 기준**: final_score 0.5 임계값이 적절한지, 사용자 피드백 기반 조정 필요
4. **배치 전환 조건**: 시스템 부하 임계값 설정 기준 (CPU 사용률? 메모리 사용률? 동시 요청 수?)
5. **중복 항목 처리**: 같은 memory_id가 여러 번 검색 결과에 포함된 경우, 각각 별도로 통계 업데이트하는 것이 맞는지, 아니면 한 번만 카운트할지

## 수정 이력

### 2025-01-08: 초기 PRD 작성 후 수정

1. **성공/실패 판정 기준 명확화**: 검색 결과 전체가 아닌 각 메모리 항목(memory_id) 단위로 판정하도록 수정
2. **Confidence 계산 필드명 수정**: `relevance_score` → `vectorScore` (실제 필드명 반영)
3. **디렉토리 구조 수정**: 저장소 가이드라인에 맞게 `src/services/` 구조 반영
4. **API 스펙 명확화**: `include_metadata` 파라미터는 이미 존재하므로 명시, `meta_stats` 필드 추가
5. **타임스탬프 포맷 명시**: `last_recalled_at`는 ISO 8601 형식으로 반환

## 참고 자료

- [GitHub Issue #66](https://github.com/jee1/memento/issues/66): Meta-Memory(1) 통계 기반 메타 메모리 수집 기능 제안
- [Memento Goals](docs/Memento-Goals.md): Memento 프로젝트 전체 목표
- [Memento M1 Detail Specs](docs/Memento-M1-DetailSpecs.md): M1 단계 상세 스펙
- [Search Ranking Memory Decay Formulas](docs/Search-Ranking-Memory-Decay-Formulas.md): 검색 랭킹 및 메모리 감쇠 공식
