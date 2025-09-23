# API 참조 문서

## 개요

Memento MCP Server는 Model Context Protocol (MCP)을 통해 AI Agent와 통신합니다. 이 문서는 제공되는 모든 Tools, Resources, Prompts에 대한 상세한 API 참조를 제공합니다.

## 🔄 경량 하이브리드 임베딩

### 경량 임베딩 서비스

OpenAI API가 없을 때 사용하는 fallback 솔루션입니다.

**특징:**
- **TF-IDF + 키워드 매칭**: 512차원 고정 벡터 생성
- **다국어 지원**: 한국어/영어 불용어 제거 및 텍스트 전처리
- **코사인 유사도**: 벡터 간 유사도 계산을 통한 검색
- **투명한 인터페이스**: 기존 임베딩 API와 동일한 인터페이스 제공

**자동 Fallback:**
- `EmbeddingService`에서 OpenAI API 실패 시 자동으로 경량 서비스로 전환
- 기존 코드 변경 없이 투명하게 작동

**성능 특성:**
- **빠른 처리**: 로컬 TF-IDF 계산으로 빠른 응답
- **메모리 효율**: 사전 학습된 모델 없이 가벼운 구현
- **정확도**: 키워드 기반 검색에 특화된 정확도

## MCP Tools

### remember

기억을 저장하는 도구입니다.

#### 파라미터

```typescript
interface RememberParams {
  content: string;                    // 기억할 내용 (필수)
  type?: 'working' | 'episodic' | 'semantic' | 'procedural';  // 기억 타입 (기본값: 'episodic')
  tags?: string[];                   // 태그 배열 (선택)
  importance?: number;               // 중요도 (0-1, 기본값: 0.5)
  source?: string;                   // 출처 (선택)
  privacy_scope?: 'private' | 'team' | 'public';  // 공개 범위 (기본값: 'private')
}
```

#### 응답

```typescript
interface RememberResult {
  memory_id: string;                 // 생성된 기억의 고유 ID
  created_at: string;               // 생성 시간 (ISO 8601)
  type: string;                     // 기억 타입
  importance: number;               // 중요도
}
```

#### 사용 예시

```typescript
// 실제 구현된 클라이언트 사용법
import { createMementoClient } from './src/client/index.js';

const client = createMementoClient();
await client.connect();

// 기본 사용법
const result = await client.callTool('remember', {
  content: "사용자가 React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다."
});

// 고급 사용법
const result = await client.callTool('remember', {
  content: "프로젝트에서 TypeScript를 도입하기로 결정했다.",
  type: 'episodic',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
  source: 'meeting-notes',
  privacy_scope: 'team'
});
```

### recall

기억을 검색하는 도구입니다.

#### 파라미터

```typescript
interface RecallParams {
  query: string;                     // 검색 쿼리 (필수)
  filters?: {
    type?: ('episodic' | 'semantic')[];  // 기억 타입 필터
    tags?: string[];                 // 태그 필터
    project_id?: string;             // 프로젝트 ID 필터
    time_from?: string;              // 시작 시간 (ISO 8601)
    time_to?: string;                // 종료 시간 (ISO 8601)
  };
  limit?: number;                    // 결과 수 제한 (기본값: 8)
}
```

#### 응답

```typescript
interface RecallResult {
  items: MemoryItem[];              // 검색된 기억 목록
  total_count: number;              // 전체 결과 수
  query_time: number;               // 검색 소요 시간 (ms)
}

interface MemoryItem {
  id: string;                       // 기억 ID
  content: string;                  // 기억 내용
  type: string;                     // 기억 타입
  importance: number;               // 중요도
  created_at: string;               // 생성 시간
  last_accessed: string;            // 마지막 접근 시간
  pinned: boolean;                  // 고정 여부
  score: number;                    // 검색 점수
  recall_reason: string;            // 검색 이유
  tags?: string[];                  // 태그
}
```

#### 사용 예시

```typescript
// 기본 검색
const result = await client.callTool('recall', {
  query: "React Hook 사용법"
});

// 필터링된 검색
const result = await client.callTool('recall', {
  query: "TypeScript",
  filters: {
    type: ['episodic', 'semantic'],
    tags: ['javascript', 'programming'],
    time_from: '2024-01-01T00:00:00Z'
  },
  limit: 10
});
```

### pin / unpin

기억을 고정하거나 고정 해제하는 도구입니다.

#### pin 파라미터

```typescript
interface PinParams {
  memory_id: string;                // 고정할 기억 ID (필수)
}
```

#### unpin 파라미터

```typescript
interface UnpinParams {
  memory_id: string;                // 고정 해제할 기억 ID (필수)
}
```

#### 응답

```typescript
interface PinResult {
  success: boolean;                 // 성공 여부
  memory_id: string;               // 기억 ID
  pinned: boolean;                 // 고정 상태
}
```

#### 사용 예시

```typescript
// 기억 고정
const result = await client.callTool('pin', {
  memory_id: 'memory-123'
});

// 기억 고정 해제
const result = await client.callTool('unpin', {
  memory_id: 'memory-123'
});
```

### forget

기억을 삭제하는 도구입니다.

#### 파라미터

```typescript
interface ForgetParams {
  memory_id: string;                // 삭제할 기억 ID (필수)
  hard?: boolean;                   // 하드 삭제 여부 (기본값: false)
}
```

#### 응답

```typescript
interface ForgetResult {
  success: boolean;                 // 성공 여부
  memory_id: string;               // 삭제된 기억 ID
  deleted_at: string;              // 삭제 시간
}
```

#### 사용 예시

```typescript
// 소프트 삭제 (기본값)
const result = await client.callTool('forget', {
  memory_id: 'memory-123'
});

// 하드 삭제
const result = await client.callTool('forget', {
  memory_id: 'memory-123',
  hard: true
});
```

### hybrid_search

하이브리드 검색을 수행하는 도구입니다. FTS5 텍스트 검색과 벡터 검색을 결합하여 더 정확한 검색 결과를 제공합니다.

#### 파라미터

```typescript
interface HybridSearchParams {
  query: string;                     // 검색 쿼리 (필수)
  filters?: {
    type?: ('episodic' | 'semantic')[];  // 기억 타입 필터
    tags?: string[];                 // 태그 필터
    project_id?: string;             // 프로젝트 ID 필터
    time_from?: string;              // 시작 시간 (ISO 8601)
    time_to?: string;                // 종료 시간 (ISO 8601)
  };
  limit?: number;                    // 결과 수 제한 (기본값: 10)
  vectorWeight?: number;             // 벡터 검색 가중치 (0.0-1.0, 기본값: 0.6)
  textWeight?: number;               // 텍스트 검색 가중치 (0.0-1.0, 기본값: 0.4)
}
```

#### 응답

```typescript
interface HybridSearchResult {
  items: HybridSearchItem[];         // 검색된 기억 목록
  total_count: number;               // 전체 결과 수
  query_time: number;                // 검색 소요 시간 (ms)
  search_type: 'hybrid';             // 검색 타입
}

interface HybridSearchItem {
  id: string;                        // 기억 ID
  content: string;                   // 기억 내용
  type: string;                      // 기억 타입
  importance: number;                // 중요도
  created_at: string;                // 생성 시간
  last_accessed?: string;            // 마지막 접근 시간
  pinned: boolean;                   // 고정 여부
  tags?: string[];                   // 태그 목록
  textScore: number;                 // FTS5 텍스트 검색 점수
  vectorScore: number;               // 벡터 유사도 점수
  finalScore: number;                // 최종 하이브리드 점수
  recall_reason: string;             // 검색 이유
}
```

#### 사용 예시

```typescript
// 기본 하이브리드 검색
const result = await client.callTool('hybrid_search', {
  query: "React Hook 사용법"
});

// 가중치 조정된 하이브리드 검색
const result = await client.callTool('hybrid_search', {
  query: "TypeScript 인터페이스",
  vectorWeight: 0.7,  // 벡터 검색 70%
  textWeight: 0.3,    // 텍스트 검색 30%
  limit: 5
});

// 필터링된 하이브리드 검색
const result = await client.callTool('hybrid_search', {
  query: "프로젝트 관리",
  filters: {
    type: ['episodic', 'semantic'],
    tags: ['project', 'management']
  },
  limit: 8
});
```

### summarize_thread

현재 세션의 대화를 요약하여 기억으로 저장하는 도구입니다.

#### 파라미터

```typescript
interface SummarizeThreadParams {
  session_id: string;               // 세션 ID (필수)
  thread_data?: {
    messages: Message[];            // 대화 메시지 배열
    context?: string;               // 추가 컨텍스트
  };
  importance?: number;              // 중요도 (기본값: 0.7)
}
```

#### 응답

```typescript
interface SummarizeThreadResult {
  memory_id: string;               // 생성된 기억 ID
  summary: string;                 // 요약 내용
  key_points: string[];            // 핵심 포인트
  created_at: string;              // 생성 시간
}
```

#### 사용 예시

```typescript
const result = await client.callTool('summarize_thread', {
  session_id: 'session-456',
  thread_data: {
    messages: [
      { role: 'user', content: 'React Hook에 대해 설명해주세요' },
      { role: 'assistant', content: 'React Hook은...' }
    ],
    context: '프론트엔드 개발 관련 질문'
  },
  importance: 0.8
});
```

### link

기억 간의 관계를 생성하는 도구입니다.

#### 파라미터

```typescript
interface LinkParams {
  source_id: string;                // 소스 기억 ID (필수)
  target_id: string;                // 대상 기억 ID (필수)
  relation_type: 'cause_of' | 'derived_from' | 'duplicates' | 'contradicts';  // 관계 타입 (필수)
}
```

#### 응답

```typescript
interface LinkResult {
  success: boolean;                 // 성공 여부
  link_id: string;                 // 생성된 링크 ID
  source_id: string;               // 소스 기억 ID
  target_id: string;               // 대상 기억 ID
  relation_type: string;           // 관계 타입
  created_at: string;              // 생성 시간
}
```

#### 사용 예시

```typescript
const result = await client.callTool('link', {
  source_id: 'memory-123',
  target_id: 'memory-456',
  relation_type: 'derived_from'
});
```

### export

기억을 다양한 형식으로 내보내는 도구입니다.

#### 파라미터

```typescript
interface ExportParams {
  format: 'json' | 'csv' | 'markdown';  // 내보내기 형식 (필수)
  filters?: {
    type?: string[];                // 기억 타입 필터
    tags?: string[];                // 태그 필터
    date_from?: string;             // 시작 날짜
    date_to?: string;               // 종료 날짜
  };
  include_metadata?: boolean;       // 메타데이터 포함 여부 (기본값: true)
}
```

#### 응답

```typescript
interface ExportResult {
  success: boolean;                 // 성공 여부
  format: string;                   // 내보내기 형식
  data: string;                     // 내보내기 데이터
  count: number;                    // 내보낸 기억 수
  exported_at: string;              // 내보내기 시간
}
```

#### 사용 예시

```typescript
// JSON 형식으로 내보내기
const result = await client.callTool('export', {
  format: 'json',
  filters: {
    type: ['episodic', 'semantic'],
    date_from: '2024-01-01'
  }
});

// Markdown 형식으로 내보내기
const result = await client.callTool('export', {
  format: 'markdown',
  include_metadata: true
});
```

### feedback

기억의 유용성에 대한 피드백을 제공하는 도구입니다.

#### 파라미터

```typescript
interface FeedbackParams {
  memory_id: string;                // 피드백할 기억 ID (필수)
  helpful: boolean;                 // 유용성 여부 (필수)
  comment?: string;                 // 추가 코멘트 (선택)
  score?: number;                   // 점수 (0-1, 선택)
}
```

#### 응답

```typescript
interface FeedbackResult {
  success: boolean;                 // 성공 여부
  memory_id: string;               // 기억 ID
  feedback_id: string;             // 피드백 ID
  helpful: boolean;                // 유용성 여부
  created_at: string;              // 피드백 시간
}
```

#### 사용 예시

```typescript
const result = await client.callTool('feedback', {
  memory_id: 'memory-123',
  helpful: true,
  comment: '매우 유용한 정보였습니다',
  score: 0.9
});
```

## MCP Resources

### memory/{id}

특정 기억의 상세 정보를 조회하는 리소스입니다.

#### URL

```
memory/{memory_id}
```

#### 응답

```typescript
interface MemoryResource {
  id: string;                       // 기억 ID
  content: string;                  // 기억 내용
  type: string;                     // 기억 타입
  importance: number;               // 중요도
  created_at: string;               // 생성 시간
  last_accessed: string;            // 마지막 접근 시간
  pinned: boolean;                  // 고정 여부
  source?: string;                  // 출처
  tags?: string[];                  // 태그
  privacy_scope: string;            // 공개 범위
  links?: {
    source_of: string[];            // 이 기억에서 파생된 기억들
    derived_from: string[];         // 이 기억이 파생된 기억들
    duplicates: string[];           // 중복 기억들
    contradicts: string[];          // 모순 기억들
  };
}
```

### memory/search

검색 결과를 캐시된 형태로 제공하는 리소스입니다.

#### URL

```
memory/search?query={query}&filters={filters}&limit={limit}
```

#### 쿼리 파라미터

- `query`: 검색 쿼리 (필수)
- `filters`: JSON 형태의 필터 (선택)
- `limit`: 결과 수 제한 (선택, 기본값: 8)

#### 응답

```typescript
interface SearchResource {
  query: string;                    // 검색 쿼리
  results: MemoryItem[];            // 검색 결과
  total_count: number;              // 전체 결과 수
  query_time: number;               // 검색 소요 시간
  cached_at: string;                // 캐시 시간
  expires_at: string;               // 캐시 만료 시간
}
```

## 8. apply_forgetting_policy

망각 정책을 적용합니다. 망각 알고리즘과 간격 반복을 통합하여 메모리를 관리합니다.

### Parameters

- `config` (object, optional): 망각 정책 설정
  - `forgetThreshold` (number, optional): 망각 임계값 (기본값: 0.6)
  - `softDeleteThreshold` (number, optional): 소프트 삭제 임계값 (기본값: 0.6)
  - `hardDeleteThreshold` (number, optional): 하드 삭제 임계값 (기본값: 0.8)
  - `ttlSoft` (object, optional): 소프트 TTL 설정 (일 단위)
    - `working` (number, optional): 작업기억 TTL (기본값: 2)
    - `episodic` (number, optional): 일화기억 TTL (기본값: 30)
    - `semantic` (number, optional): 의미기억 TTL (기본값: 180)
    - `procedural` (number, optional): 절차기억 TTL (기본값: 90)
  - `ttlHard` (object, optional): 하드 TTL 설정 (일 단위)
    - `working` (number, optional): 작업기억 TTL (기본값: 7)
    - `episodic` (number, optional): 일화기억 TTL (기본값: 180)
    - `semantic` (number, optional): 의미기억 TTL (기본값: 365)
    - `procedural` (number, optional): 절차기억 TTL (기본값: 180)

### Response

```typescript
interface ForgettingPolicyResult {
  softDeleted: string[];
  hardDeleted: string[];
  scheduledForReview: ReviewSchedule[];
  processedCount: number;
  errorCount: number;
}

interface ReviewSchedule {
  memory_id: string;
  current_interval: number;
  next_review: string;
  recall_probability: number;
  needs_review: boolean;
  multiplier: number;
}
```

### Usage Example

```typescript
// 기본 망각 정책 적용
const result = await client.callTool('apply_forgetting_policy', {});

// 사용자 정의 설정으로 망각 정책 적용
const result = await client.callTool('apply_forgetting_policy', {
  config: {
    forgetThreshold: 0.7,
    softDeleteThreshold: 0.7,
    hardDeleteThreshold: 0.9,
    ttlSoft: {
      working: 3,
      episodic: 45,
      semantic: 200,
      procedural: 120
    }
  }
});
```

## 9. schedule_review

간격 반복을 위한 리뷰 스케줄을 생성합니다.

### Parameters

- `memory_id` (string, required): 메모리 ID
- `features` (object, optional): 간격 반복 특징
  - `importance` (number, optional): 중요도 (0-1)
  - `usage` (number, optional): 사용성 (0-1)
  - `helpful_feedback` (number, optional): 도움됨 피드백 (0-1)
  - `bad_feedback` (number, optional): 나쁨 피드백 (0-1)

### Response

```typescript
interface ReviewSchedule {
  memory_id: string;
  current_interval: number;
  next_review: string;
  recall_probability: number;
  needs_review: boolean;
  multiplier: number;
}
```

### Usage Example

```typescript
// 기본 리뷰 스케줄 생성
const schedule = await client.callTool('schedule_review', {
  memory_id: 'memory-123'
});

// 특징을 고려한 리뷰 스케줄 생성
const schedule = await client.callTool('schedule_review', {
  memory_id: 'memory-123',
  features: {
    importance: 0.8,
    usage: 0.6,
    helpful_feedback: 0.7,
    bad_feedback: 0.1
  }
});
```

## 10. 성능 모니터링

### `get_performance_metrics`

시스템의 성능 메트릭을 조회합니다.

#### 매개변수

```typescript
{
  timeRange?: '1h' | '24h' | '7d' | '30d';  // 시간 범위
  includeDetails?: boolean;                  // 상세 정보 포함 여부
}
```

#### 응답

```typescript
{
  success: boolean;
  result: {
    database: {
      totalMemories: number;
      memoryByType: Record<string, number>;
      averageMemorySize: number;
      databaseSize: number;
      queryPerformance: {
        averageQueryTime: number;
        slowQueries: Array<{ query: string; time: number; count: number }>;
      };
    };
    search: {
      totalSearches: number;
      averageSearchTime: number;
      cacheHitRate: number;
      embeddingSearchRate: number;
    };
    memory: {
      usage: number;
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    system: {
      uptime: number;
      cpuUsage: number;
      loadAverage: number[];
    };
  };
}
```

#### 사용 예시

```typescript
// 기본 성능 메트릭 조회
const metrics = await client.callTool('get_performance_metrics', {});

// 24시간 상세 메트릭 조회
const metrics = await client.callTool('get_performance_metrics', {
  timeRange: '24h',
  includeDetails: true
});

console.log(`총 메모리 수: ${metrics.result.database.totalMemories}`);
console.log(`평균 검색 시간: ${metrics.result.search.averageSearchTime}ms`);
console.log(`캐시 히트율: ${(metrics.result.search.cacheHitRate * 100).toFixed(1)}%`);
```

## 11. 캐시 관리

### `get_cache_stats`

캐시 시스템의 통계를 조회합니다.

#### 매개변수

```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // 캐시 타입
}
```

#### 응답

```typescript
{
  success: boolean;
  result: {
    hits: number;
    misses: number;
    totalRequests: number;
    hitRate: number;
    size: number;
    memoryUsage: number;
  };
}
```

#### 사용 예시

```typescript
// 전체 캐시 통계 조회
const stats = await client.callTool('get_cache_stats', {});

// 검색 캐시만 조회
const stats = await client.callTool('get_cache_stats', {
  cacheType: 'search'
});

console.log(`캐시 히트율: ${(stats.result.hitRate * 100).toFixed(1)}%`);
console.log(`캐시 크기: ${stats.result.size}개 항목`);
console.log(`메모리 사용량: ${(stats.result.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
```

### `clear_cache`

캐시를 초기화합니다.

#### 매개변수

```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // 캐시 타입
  pattern?: string;                             // 제거할 패턴 (정규식)
}
```

#### 응답

```typescript
{
  success: boolean;
  result: {
    clearedCount: number;                       // 제거된 항목 수
    remainingCount: number;                     // 남은 항목 수
  };
}
```

#### 사용 예시

```typescript
// 전체 캐시 초기화
const result = await client.callTool('clear_cache', {});

// 검색 캐시만 초기화
const result = await client.callTool('clear_cache', {
  cacheType: 'search'
});

// 특정 패턴의 캐시 제거
const result = await client.callTool('clear_cache', {
  pattern: 'search:.*test.*'
});

console.log(`제거된 항목: ${result.result.clearedCount}개`);
```

## 12. 데이터베이스 최적화

### `optimize_database`

데이터베이스 성능을 최적화합니다.

#### 매개변수

```typescript
{
  actions?: ('analyze' | 'index' | 'vacuum' | 'all')[];  // 수행할 작업
  autoCreateIndexes?: boolean;                           // 자동 인덱스 생성
}
```

#### 응답

```typescript
{
  success: boolean;
  result: {
    analyzedQueries: number;
    createdIndexes: number;
    optimizedTables: number;
    recommendations: Array<{
      type: 'index' | 'query' | 'table';
      priority: 'high' | 'medium' | 'low';
      description: string;
      estimatedImprovement: string;
    }>;
  };
}
```

#### 사용 예시

```typescript
// 전체 데이터베이스 최적화
const result = await client.callTool('optimize_database', {
  actions: ['all'],
  autoCreateIndexes: true
});

// 쿼리 분석만 수행
const result = await client.callTool('optimize_database', {
  actions: ['analyze']
});

console.log(`생성된 인덱스: ${result.result.createdIndexes}개`);
console.log(`최적화된 테이블: ${result.result.optimizedTables}개`);
```

## MCP Prompts

### memory_injection

AI Agent의 컨텍스트에 관련 기억을 주입하는 프롬프트입니다.

#### 파라미터

```typescript
interface MemoryInjectionParams {
  query: string;                    // 검색 쿼리 (필수)
  token_budget?: number;            // 토큰 예산 (기본값: 1200)
  context_type?: 'conversation' | 'task' | 'general';  // 컨텍스트 타입 (기본값: 'general')
}
```

#### 응답

```typescript
interface MemoryInjectionPrompt {
  role: 'system';
  content: string;                  // 주입할 컨텍스트 내용
  metadata: {
    memories_used: number;          // 사용된 기억 수
    token_count: number;            // 실제 사용된 토큰 수
    search_time: number;            // 검색 소요 시간
  };
}
```

#### 사용 예시

```typescript
const prompt = await client.getPrompt('memory_injection', {
  query: "React 개발 관련 질문",
  token_budget: 1500,
  context_type: 'conversation'
});
```

## 에러 처리

### 에러 코드

| 코드 | 설명 |
|------|------|
| `MEMORY_NOT_FOUND` | 기억을 찾을 수 없음 |
| `INVALID_INPUT` | 잘못된 입력 파라미터 |
| `STORAGE_ERROR` | 저장소 오류 |
| `SEARCH_ERROR` | 검색 오류 |
| `AUTHENTICATION_ERROR` | 인증 오류 (M2+) |
| `PERMISSION_DENIED` | 권한 없음 (M3+) |
| `RATE_LIMIT_EXCEEDED` | 요청 한도 초과 |
| `INTERNAL_ERROR` | 내부 서버 오류 |

### 에러 응답 형식

```typescript
interface ErrorResponse {
  error: {
    code: string;                   // 에러 코드
    message: string;                // 에러 메시지
    details?: any;                  // 추가 세부사항
    timestamp: string;              // 에러 발생 시간
  };
}
```

## 성능 고려사항

### 검색 성능

- **벡터 검색**: 평균 50-100ms
- **키워드 검색**: 평균 20-50ms
- **복합 검색**: 평균 100-200ms

### 메모리 사용량

- **기억당 평균 크기**: 1-5KB
- **임베딩 크기**: 1536차원 × 4바이트 = 6KB
- **인덱스 오버헤드**: 데이터의 약 20-30%

### 제한사항

- **최대 기억 크기**: 10MB
- **검색 결과 제한**: 100개
- **동시 연결 수**: 100개 (M1), 1000개 (M3+)
- **API 요청 한도**: 1000회/시간 (M1), 10000회/시간 (M3+)

## 버전 관리

### API 버전

현재 API 버전: `v1.0.0`

### 호환성

- **MCP 프로토콜**: 2025-03-26
- **TypeScript**: 5.0+
- **Node.js**: 20+

### 마이그레이션 가이드

버전 업그레이드 시 변경사항은 [CHANGELOG.md](../CHANGELOG.md)를 참조하세요.
