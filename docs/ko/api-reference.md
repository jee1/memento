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

### 성능 모니터링 Tools

#### get_performance_metrics

시스템의 성능 메트릭을 조회합니다.

**파라미터:**
```typescript
{
  timeRange?: '1h' | '24h' | '7d' | '30d';  // 시간 범위
  includeDetails?: boolean;                  // 상세 정보 포함 여부
}
```

**응답:**
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

#### get_cache_stats

캐시 시스템의 통계를 조회합니다.

**파라미터:**
```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // 캐시 타입
}
```

**응답:**
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

#### clear_cache

캐시를 초기화합니다.

**파라미터:**
```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // 캐시 타입
  pattern?: string;                             // 제거할 패턴 (정규식)
}
```

**응답:**
```typescript
{
  success: boolean;
  result: {
    clearedCount: number;                       // 제거된 항목 수
    remainingCount: number;                     // 남은 항목 수
  };
}
```

#### optimize_database

데이터베이스 성능을 최적화합니다.

**파라미터:**
```typescript
{
  actions?: ('analyze' | 'index' | 'vacuum' | 'all')[];  // 수행할 작업
  autoCreateIndexes?: boolean;                           // 자동 인덱스 생성
}
```

**응답:**
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

## MCP Tools (핵심 15개)

> **중요**: MCP 클라이언트는 핵심 메모리 관리 기능 15개를 노출합니다.  
> 관리 기능들은 HTTP API 엔드포인트로 분리되었습니다.  
> 자세한 내용은 [관리자 API](#관리자-api) 섹션을 참조하세요.

### 핵심 메모리 관리 도구 (7개)

1. **remember** - 기억 저장
2. **recall** - 기억 검색
3. **forget** - 기억 삭제
4. **pin** - 기억 고정
5. **unpin** - 기억 고정 해제
6. **get_memory_neighbors** - 유사한 기억 조회
7. **memory_injection** - 관련 기억을 컨텍스트에 주입 (Prompt)

### 앵커 시스템 도구 (5개)

8. **set_anchor** - 기억을 앵커로 설정
9. **get_anchor** - 현재 앵커 조회
10. **search_local** - 앵커 주변 검색
11. **clear_anchor** - 앵커 제거
12. **restore_anchors** - 데이터베이스에서 앵커 복원

### 관리 도구 (3개)

13. **migrate_embeddings** - 임베딩 제공자 간 마이그레이션
14. **convert_episodic_to_semantic** - 일화기억을 의미기억으로 변환
15. **get_meta_memory_stats** - 메모리 통계 조회

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

### get_memory_neighbors

특정 기억과 유사한 이웃 기억을 조회하는 도구입니다. 벡터 유사도를 기반으로 의미적으로 유사한 기억들을 자동으로 찾아 추천합니다.

#### 파라미터

```typescript
interface GetMemoryNeighborsParams {
  memory_id: string;                  // 조회할 기억 ID (필수)
  limit?: number;                     // 반환할 이웃 기억의 최대 개수 (기본값: 5, 최대: 50)
  similarity_threshold?: number;      // 유사도 임계값 (0.0 ~ 1.0, 기본값: 0.8)
}
```

#### 응답

```typescript
interface GetMemoryNeighborsResult {
  memory_id: string;                  // 조회한 기억 ID
  neighbors: NeighborMemory[];        // 이웃 기억 목록
  total_count: number;                 // 반환된 이웃 기억 개수
  query_time: number;                  // 쿼리 실행 시간 (ms)
}

interface NeighborMemory {
  id: string;                         // 이웃 기억 ID
  content: string;                    // 이웃 기억 내용
  type: string;                       // 이웃 기억 타입
  similarity: number;                 // 유사도 점수 (0.0 ~ 1.0)
  importance?: number;                // 중요도
  created_at?: string;                // 생성 시간
  tags?: string[];                    // 태그
}
```

#### 사용 예시

```typescript
// 기본 사용법 (5개 이웃 기억 조회, 유사도 0.8 이상)
const result = await client.callTool('get_memory_neighbors', {
  memory_id: 'mem_123'
});

// 고급 사용법 (10개 이웃 기억 조회, 유사도 0.7 이상)
const result = await client.callTool('get_memory_neighbors', {
  memory_id: 'mem_123',
  limit: 10,
  similarity_threshold: 0.7
});

// 결과 활용
result.neighbors.forEach(neighbor => {
  console.log(`유사한 기억: ${neighbor.content} (유사도: ${neighbor.similarity})`);
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

### set_anchor

기억을 앵커로 설정하여 컨텍스트 관리를 하는 도구입니다.

#### 파라미터

```typescript
interface SetAnchorParams {
  memory_id: string;                // 앵커로 설정할 기억 ID (필수)
  slot: 'A' | 'B' | 'C';          // 앵커 슬롯 (필수)
  agent_id?: string;               // 에이전트 ID (기본값: 'default')
}
```

#### 응답

```typescript
interface SetAnchorResult {
  success: boolean;                 // 성공 여부
  memory_id: string;               // 기억 ID
  slot: string;                    // 앵커 슬롯
  agent_id: string;                // 에이전트 ID
}
```

#### 사용 예시

```typescript
// 슬롯 A에 앵커 설정 (즉시 컨텍스트)
const result = await client.callTool('set_anchor', {
  memory_id: 'mem_123',
  slot: 'A'
});

// 슬롯 B에 앵커 설정 (보조 컨텍스트)
const result = await client.callTool('set_anchor', {
  memory_id: 'mem_456',
  slot: 'B',
  agent_id: 'my-agent'
});
```

### get_anchor

현재 설정된 앵커를 조회하는 도구입니다.

#### 파라미터

```typescript
interface GetAnchorParams {
  slot?: 'A' | 'B' | 'C';         // 조회할 슬롯 (선택, 지정하지 않으면 모든 슬롯 반환)
  agent_id?: string;               // 에이전트 ID (기본값: 'default')
}
```

#### 응답

```typescript
interface GetAnchorResult {
  agent_id: string;                // 에이전트 ID
  slot?: string;                   // 슬롯 (특정 슬롯 조회 시)
  anchor?: {                       // 앵커 정보 (특정 슬롯 조회 시)
    memory_id: string;
    created_at: string;
    updated_at: string;
  };
  anchors?: {                      // 모든 앵커 (슬롯 미지정 시)
    A: AnchorInfo | null;
    B: AnchorInfo | null;
    C: AnchorInfo | null;
  };
}

interface AnchorInfo {
  memory_id: string;
  created_at: string;
  updated_at: string;
}
```

#### 사용 예시

```typescript
// 특정 앵커 조회
const result = await client.callTool('get_anchor', {
  slot: 'A'
});

// 모든 앵커 조회
const result = await client.callTool('get_anchor', {});
```

### search_local

앵커 주변의 기억을 검색하는 도구입니다.

#### 파라미터

```typescript
interface SearchLocalParams {
  slot: 'A' | 'B' | 'C';          // 검색할 앵커 슬롯 (필수)
  query?: string;                  // 검색 쿼리 (선택, 제공하지 않으면 앵커 주변 모든 기억 반환)
  hop_limit?: number;              // 최대 hop 거리 (1-5, 기본값: 슬롯별 설정)
  limit?: number;                  // 최대 결과 수 (1-100, 기본값: 10)
  min_results?: number;            // 최소 결과 수 (0-100, 기본값: 3)
  agent_id?: string;               // 에이전트 ID (기본값: 'default')
  use_relations?: boolean;         // 관계 그래프 사용 여부 (기본값: true)
}
```

#### 응답

```typescript
interface SearchLocalResult {
  slot: string;                    // 앵커 슬롯
  query?: string;                  // 검색 쿼리
  items: MemoryItem[];            // 검색된 기억 목록
  total_count: number;             // 전체 결과 수
  query_time: number;              // 쿼리 실행 시간 (ms)
}
```

#### 사용 예시

```typescript
// 앵커 A 주변 검색
const result = await client.callTool('search_local', {
  slot: 'A',
  query: 'React hooks',
  limit: 10
});

// 앵커 B 주변 모든 기억 조회
const result = await client.callTool('search_local', {
  slot: 'B',
  hop_limit: 2
});
```

### clear_anchor

앵커를 제거하는 도구입니다.

#### 파라미터

```typescript
interface ClearAnchorParams {
  slot?: 'A' | 'B' | 'C';         // 제거할 슬롯 (선택, 지정하지 않으면 모든 슬롯 제거)
  agent_id?: string;               // 에이전트 ID (기본값: 'default')
}
```

#### 응답

```typescript
interface ClearAnchorResult {
  success: boolean;                 // 성공 여부
  agent_id: string;                // 에이전트 ID
  slot?: string;                   // 제거된 슬롯
  message: string;                 // 결과 메시지
}
```

#### 사용 예시

```typescript
// 특정 앵커 제거
const result = await client.callTool('clear_anchor', {
  slot: 'A'
});

// 모든 앵커 제거
const result = await client.callTool('clear_anchor', {});
```

### restore_anchors

데이터베이스에서 앵커를 복원하는 도구입니다.

#### 파라미터

```typescript
interface RestoreAnchorsParams {
  agent_id?: string;               // 에이전트 ID (기본값: 'default')
}
```

#### 응답

```typescript
interface RestoreAnchorsResult {
  success: boolean;                 // 성공 여부
  agent_id: string;                // 에이전트 ID
  restored_count: number;          // 복원된 앵커 개수
  anchors: {
    A: AnchorInfo | null;
    B: AnchorInfo | null;
    C: AnchorInfo | null;
  };
}
```

#### 사용 예시

```typescript
// 데이터베이스에서 앵커 복원
const result = await client.callTool('restore_anchors', {
  agent_id: 'my-agent'
});
```

### migrate_embeddings

임베딩 제공자 간 마이그레이션을 수행하는 도구입니다.

#### 파라미터

```typescript
interface MigrateEmbeddingsParams {
  target_provider: 'tfidf' | 'lightweight' | 'minilm' | 'openai' | 'gemini';  // 대상 제공자 (필수)
  source_provider?: 'tfidf' | 'lightweight' | 'minilm' | 'openai' | 'gemini'; // 소스 제공자 (선택, 지정하지 않으면 모든 제공자 마이그레이션)
  batch_size?: number;            // 배치 크기 (1-1000, 기본값: 100)
  dry_run?: boolean;               // 시뮬레이션 모드 (기본값: false)
}
```

#### 응답

```typescript
interface MigrateEmbeddingsResult {
  success: boolean;                 // 성공 여부
  target_provider: string;         // 대상 제공자
  migrated_count: number;          // 마이그레이션된 임베딩 개수
  failed_count: number;            // 실패한 마이그레이션 개수
  dry_run: boolean;                // 시뮬레이션 모드
}
```

#### 사용 예시

```typescript
// 모든 임베딩을 OpenAI로 마이그레이션
const result = await client.callTool('migrate_embeddings', {
  target_provider: 'openai',
  batch_size: 100
});

// 시뮬레이션 모드로 마이그레이션
const result = await client.callTool('migrate_embeddings', {
  target_provider: 'gemini',
  dry_run: true
});
```

### convert_episodic_to_semantic

일화기억을 의미기억으로 변환하는 도구입니다.

#### 파라미터

```typescript
interface ConvertEpisodicToSemanticParams {
  memory_id?: string;              // 변환할 기억 ID (선택, 지정하지 않으면 배치 변환)
  skip_converted?: boolean;        // 이미 변환된 항목 건너뛰기 (기본값: true)
  retry_failed?: boolean;          // 실패한 항목 재시도 (기본값: false)
  limit?: number;                  // 배치 크기 (1-100, 기본값: 10)
}
```

#### 응답

```typescript
interface ConvertEpisodicToSemanticResult {
  success: boolean;                 // 성공 여부
  converted_count: number;         // 변환된 기억 개수
  failed_count: number;            // 실패한 변환 개수
  skipped_count: number;          // 건너뛴 기억 개수
}
```

#### 사용 예시

```typescript
// 특정 기억 변환
const result = await client.callTool('convert_episodic_to_semantic', {
  memory_id: 'mem_123'
});

// 배치 변환
const result = await client.callTool('convert_episodic_to_semantic', {
  limit: 20,
  retry_failed: true
});
```

### get_meta_memory_stats

메타 메모리 통계(recall 성공률, 신뢰도 점수 등)를 조회하는 도구입니다.

#### 파라미터

```typescript
interface GetMetaMemoryStatsParams {
  memory_id?: string;              // 단일 기억 ID (memory_ids와 동시 사용 불가)
  memory_ids?: string[];           // 기억 ID 배열 (memory_id와 동시 사용 불가)
  min_recall_count?: number;       // 최소 recall_count (>= 0)
  min_confidence?: number;         // 최소 평균 신뢰도 (0-1)
  limit?: number;                  // 결과 제한 수 (1-1000, 기본값: 100)
}
```

#### 응답

```typescript
interface GetMetaMemoryStatsResult {
  items: MetaMemoryStatsItem[];    // 통계 항목 목록
  total_count: number;             // 전체 결과 수
  message: string;                 // 결과 메시지
}

interface MetaMemoryStatsItem {
  memory_id: string;               // 기억 ID
  recall_count: number;            // 전체 recall 횟수
  success_count: number;           // 성공한 recall 횟수
  failure_count: number;           // 실패한 recall 횟수
  avg_confidence: number;          // 평균 신뢰도 점수
  last_recalled_at?: string;       // 마지막 recall 시간 (ISO 8601)
  created_at: string;              // 생성 시간 (ISO 8601)
  updated_at: string;              // 업데이트 시간 (ISO 8601)
}
```

#### 사용 예시

```typescript
// 특정 기억 통계 조회
const result = await client.callTool('get_meta_memory_stats', {
  memory_id: 'mem_123'
});

// 여러 기억 통계 조회
const result = await client.callTool('get_meta_memory_stats', {
  memory_ids: ['mem_1', 'mem_2', 'mem_3']
});

// 최소 recall 횟수 및 신뢰도로 필터링
const result = await client.callTool('get_meta_memory_stats', {
  min_recall_count: 10,
  min_confidence: 0.5,
  limit: 50
});
```

## 관리자 API

> **참고**: 다음 기능들은 MCP 클라이언트에서 제거되고 HTTP API 엔드포인트로 분리되었습니다.

### 메모리 관리 API

#### 이웃 기억 조회
```http
GET /memories/:id/neighbors?limit=5&similarity_threshold=0.8
```
특정 기억과 유사한 이웃 기억을 조회합니다.

**쿼리 파라미터:**
- `limit` (optional): 반환할 이웃 기억의 최대 개수 (기본값: 5, 최대: 50)
- `similarity_threshold` (optional): 유사도 임계값 (기본값: 0.8, 범위: 0.0 ~ 1.0)

**응답:**
```json
{
  "memory_id": "mem_123",
  "neighbors": [
    {
      "id": "mem_456",
      "content": "유사한 기억 내용",
      "type": "episodic",
      "similarity": 0.85,
      "importance": 0.7,
      "created_at": "2024-01-01T00:00:00Z",
      "tags": ["tag1", "tag2"]
    }
  ],
  "total_count": 1,
  "query_time": 45,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**에러 응답:**
- `404`: 메모리를 찾을 수 없음
- `400`: 잘못된 파라미터
- `500`: 서버 오류

#### 메모리 정리
```http
POST /admin/memory/cleanup
```
메모리를 정리합니다.

**응답:**
```json
{
  "message": "메모리 정리 완료"
}
```

#### 망각 통계
```http
GET /admin/stats/forgetting
```
망각 통계를 조회합니다.

**응답:**
```json
{
  "message": "망각 통계 조회 완료"
}
```

### 성능 모니터링 API

#### 성능 통계
```http
GET /admin/stats/performance
```
성능 통계를 조회합니다.

**응답:**
```json
{
  "message": "성능 통계 조회 완료"
}
```

#### 성능 알림
```http
GET /admin/alerts/performance
```
성능 알림을 조회합니다.

**응답:**
```json
{
  "message": "성능 알림 조회 완료"
}
```

### 에러 관리 API

#### 에러 통계
```http
GET /admin/stats/errors
```
에러 통계를 조회합니다.

**응답:**
```json
{
  "message": "에러 통계 조회 완료"
}
```

#### 에러 해결
```http
POST /admin/errors/resolve
Content-Type: application/json

{
  "errorId": "error-123",
  "resolvedBy": "admin",
  "reason": "데이터베이스 연결 문제 해결됨"
}
```
에러를 해결 상태로 표시합니다.

**응답:**
```json
{
  "message": "에러 해결 완료"
}
```

### 데이터베이스 관리 API

#### 데이터베이스 최적화
```http
POST /admin/database/optimize
```
데이터베이스를 최적화합니다.

**응답:**
```json
{
  "message": "데이터베이스 최적화 완료"
}
```

## 제거된 MCP Tools

다음 도구들은 MCP 클라이언트에서 제거되었습니다:

- `hybrid_search` - 하이브리드 검색 (기본 `recall`로 대체)
- `summarize_thread` - 세션 요약 (향후 구현 예정)
- `link` - 기억 관계 생성 (향후 구현 예정)
- `export` - 기억 내보내기 (향후 구현 예정)
- `feedback` - 피드백 제공 (향후 구현 예정)
- `apply_forgetting_policy` - 망각 정책 적용 (HTTP API로 이동)
- `schedule_review` - 리뷰 스케줄링 (HTTP API로 이동)
- `get_performance_metrics` - 성능 메트릭 조회 (HTTP API로 이동)
- `get_cache_stats` - 캐시 통계 조회 (HTTP API로 이동)
- `clear_cache` - 캐시 정리 (HTTP API로 이동)
- `optimize_database` - 데이터베이스 최적화 (HTTP API로 이동)
- `error_stats` - 에러 통계 조회 (HTTP API로 이동)
- `resolve_error` - 에러 해결 (HTTP API로 이동)
- `performance_alerts` - 성능 알림 관리 (HTTP API로 이동)

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
