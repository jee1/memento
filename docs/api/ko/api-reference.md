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

## MCP Tools (핵심 도구)

> **핵심 원칙**: AI Agent가 직접 사용하는 핵심 기능만 노출  
> **중요**: 관리/운영성 기능(앵커 복원, 임베딩 마이그레이션, Episodic→Semantic 변환, 메타 메모리 통계)은 HTTP API로만 제공됩니다.  
> 자세한 내용은 [관리자 API](#관리자-api) 섹션을 참조하세요.

### 1. 핵심 메모리 관리 도구 (5개)

1. **remember** - 기억 저장
2. **recall** - 기억 검색
3. **forget** - 기억 삭제
4. **pin** - 기억 고정
5. **unpin** - 기억 고정 해제

### 2. 고급 메모리 기능 (2개)

6. **get_memory_neighbors** - 유사한 기억 조회
7. **memory_injection** - 관련 기억을 컨텍스트에 주입 (Prompt)

### 3. 앵커 시스템 도구 (4개)

8. **set_anchor** - 기억을 앵커로 설정
9. **get_anchor** - 현재 앵커 조회
10. **search_local** - 앵커 주변 검색
11. **clear_anchor** - 앵커 제거

### 4. 절차 기억·고급 도구 (3개)

12. **remember_procedure** - 절차 기억 저장 (workflow_name, skill_name, steps 등)
13. **procedural_diff** - 절차 기억 버전 간 차이 비교
14. **procedural_rollback** - 절차 기억 이전 버전으로 복원

### 5. 관계·트리플 (1개)

15. **extract_triples** - 대화·본문 텍스트에서 트리플을 추출하고, 선택한 항목만 지식 그래프에 저장합니다.

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
// Use the workspace package `@memento/client` (see `packages/memento-client`).
import { createMementoClient } from '@memento/client';

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


## 관리자 API

> **중요**: 다음 기능들은 MCP 클라이언트에 노출되지 않으며, HTTP API로만 제공됩니다.

### 앵커 관리

#### 앵커 복원
```http
POST /admin/anchors/restore
Content-Type: application/json

{
  "agent_id": "default"  // 선택사항
}
```

데이터베이스에서 앵커 상태를 메모리 캐시로 복원합니다.

**응답:**
```json
{
  "message": "앵커 복원 완료",
  "success": true,
  "restored_anchors": {
    "default": {
      "A": { "memory_id": "mem_123", "slot": "A" },
      "B": null,
      "C": null
    }
  },
  "agent_count": 1,
  "total_anchors": 1,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 임베딩 관리

#### 임베딩 마이그레이션
```http
POST /admin/embeddings/migrate
Content-Type: application/json

{
  "target_provider": "openai",
  "source_provider": "minilm",  // 선택사항
  "batch_size": 100,             // 선택사항 (기본값: 100)
  "dry_run": false               // 선택사항 (기본값: false)
}
```

기존 기억을 새로운 임베딩 provider로 재임베딩합니다.

**응답:**
```json
{
  "message": "임베딩 마이그레이션 완료",
  "success": true,
  "total_count": 1000,
  "success_count": 995,
  "failed_count": 5,
  "failed_memory_ids": ["mem_1", "mem_2"],
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 메모리 관리 API

#### Episodic → Semantic 변환
```http
POST /admin/memory/convert-episodic-to-semantic
Content-Type: application/json

{
  "memory_id": "mem_123",        // 선택사항 (단일 변환)
  "skip_converted": true,         // 선택사항 (기본값: true)
  "retry_failed": false,          // 선택사항 (기본값: false)
  "limit": 10                     // 선택사항 (기본값: 10)
}
```

일화기억을 의미기억으로 변환합니다. Triple 추출 및 Semantic Memory 생성을 수행합니다.

**응답:**
```json
{
  "message": "Episodic → Semantic 변환 완료",
  "success": true,
  "converted_count": 8,
  "failed_count": 2,
  "skipped_count": 0,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### 메타 메모리 통계 조회
```http
GET /admin/memory/meta-stats?memory_id=mem_123&min_recall_count=10&min_confidence=0.5&limit=50
```

메타 메모리 통계(recall 성공률, 신뢰도 점수 등)를 조회합니다.

**쿼리 파라미터:**
- `memory_id` (optional): 단일 기억 ID
- `memory_ids` (optional): 기억 ID 배열 (쉼표로 구분)
- `min_recall_count` (optional): 최소 recall_count (>= 0)
- `min_confidence` (optional): 최소 평균 신뢰도 (0-1)
- `limit` (optional): 결과 제한 수 (1-1000, 기본값: 100)

**응답:**
```json
{
  "message": "메타 메모리 통계 조회 완료",
  "success": true,
  "items": [
    {
      "memory_id": "mem_123",
      "recall_count": 25,
      "success_count": 23,
      "failure_count": 2,
      "avg_confidence": 0.85,
      "last_recalled_at": "2024-01-01T00:00:00Z",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total_count": 1,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

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

#### 기억 리뷰 후보 (MVP)

에이전트/운영자가 **리뷰 큐**(`memory_review_candidate`)를 HTTP Admin으로 조회하고, `review` 또는 `dismiss`로 처리합니다. 후보 행은 배치 작업 `memory_review_candidates`가 주기적으로 선정·갱신합니다. 모든 경로는 **`/admin` 마운트**와 기존과 동일한 **브라우저 세션** 인증 하에서만 동작합니다.

> **GitHub #244 참고**: 이슈 초안에 등장한 `MEMORY_REVIEW_INTERVAL_MS`, `MEMORY_REVIEW_CANDIDATE_TTL_DAYS` 등은 현재 `main` 코드와 이름이 다르거나 정의되어 있지 않습니다. 아래 환경 변수와 경로는 **런타임 기준**입니다.

##### 후보 목록

```http
GET /admin/memory/review-candidates
GET /admin/memory/review-candidates?status=pending
```

**쿼리 파라미터**

- `status` (선택): `pending` \| `reviewed` \| `dismissed` \| `expired`. 생략 시 전체 상태.

**응답 (200)**

`candidates` 배열 원소는 큐 테이블 메타(`id`, `memory_id`, `status`, `priority`, `reason`, `due_at`, 타임스탬프, `metadata_json`)만 포함합니다. **`memory_item.content` 등 기억 본문은 포함하지 않습니다.** 본문이 필요하면 `memory_id`로 다른 메모리 조회 API를 사용합니다.

```json
{
  "message": "Memory review candidates",
  "candidates": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "memory_id": "mem_abc123",
      "status": "pending",
      "priority": 0.82,
      "reason": "stale_high_importance",
      "due_at": "2026-05-16T12:00:00.000Z",
      "created_at": "2026-05-02T10:00:00.000Z",
      "updated_at": "2026-05-02T10:00:00.000Z",
      "reviewed_at": null,
      "dismissed_at": null,
      "metadata_json": "{\"score_breakdown\":{}}"
    }
  ],
  "timestamp": "2026-05-02T12:00:00.000Z"
}
```

**에러**

- `400`: 잘못된 `status` 값
- `500`: DB 미연결 등 서버 오류

##### 리뷰 큐 SSE (선택 실시간)

```http
GET /admin/memory/review-candidates/stream
```

다른 `/admin` 경로와 동일한 **브라우저 세션 쿠키**가 필요합니다. 응답은 **`text/event-stream`**이며, 다음을 포함합니다.

- `retry:` — 브라우저 `EventSource` 재연결 힌트
- `event: ready` — 연결 수립(본문 `{"ok":true}`)
- 주기적 `: ping` 코멘트(연결 유지)
- `event: changed` — 큐가 바뀌었을 수 있음; 본문에 `reason` (`review`, `dismiss`, `batch_memory_review_candidates`)

대시보드는 pending 목록 로드 성공 후 스트림을 연고, `EventSource` 미지원·오류 시 **#255 폴링으로 폴백**합니다. **단일 프로세스** 전제(레플리카 간 브로드캐스트 없음).

##### 단일 기억 프리뷰 (Admin)

리뷰 후보 목록에 본문이 없을 때, 대시보드 등에서 `memory_id`로 **`memory_item` 한 행**을 조회합니다.

```http
GET /admin/memory/items/:memory_id
```

- `:memory_id`는 URL 인코딩된 문자열이며, **`mem_` + 영문·숫자·밑줄(`_`)** 패턴만 허용합니다. 그 외 형식은 `400`입니다.
- 소프트 삭제(`is_deleted = 1`)된 기억은 `404`입니다.

**응답 (200)**

```json
{
  "message": "Memory item",
  "memory": {
    "id": "mem_abc123",
    "type": "semantic",
    "content": "…",
    "importance": 0.82,
    "privacy_scope": "private",
    "pinned": false,
    "created_at": "2026-05-02T10:00:00.000Z",
    "last_accessed": null,
    "last_accessed_at": null,
    "tags": null,
    "source": null,
    "project_id": null,
    "owner_id": null
  },
  "timestamp": "2026-05-03T12:00:00.000Z"
}
```

**에러**

- `400`: 잘못된 `memory_id` 형식
- `404`: 해당 ID 없음 또는 삭제됨
- `500`: DB 미연결 등 서버 오류

##### 후보 리뷰 완료

```http
POST /admin/memory/review-candidates/:id/review
Content-Type: application/json

{}
```

**응답 (200)**

```json
{
  "ok": true,
  "candidate": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "memory_id": "mem_abc123",
    "status": "reviewed",
    "priority": 0.82,
    "reason": "stale_high_importance",
    "due_at": "2026-05-16T12:00:00.000Z",
    "created_at": "2026-05-02T10:00:00.000Z",
    "updated_at": "2026-05-02T12:00:00.000Z",
    "reviewed_at": "2026-05-02T12:00:00.000Z",
    "dismissed_at": null,
    "metadata_json": null
  },
  "timestamp": "2026-05-02T12:00:00.000Z"
}
```

**에러**

- `400`: `:id`가 UUID 형식이 아님
- `404`: 후보 없음 — 본문에 `code`: `memory_review_candidate_not_found` 포함
- `409`: `pending`이 아님(재호출 등) — `code`: `memory_review_candidate_not_actionable`
- `500`: 그 외 서버 오류

##### 후보 기각

```http
POST /admin/memory/review-candidates/:id/dismiss
Content-Type: application/json

{}
```

응답·에러 매핑은 **리뷰 완료**와 동일하며, 성공 시 `status`가 `dismissed`로 갱신됩니다.

##### 후보 일괄 기각·만료

```http
POST /admin/memory/review-candidates/bulk-dismiss
POST /admin/memory/review-candidates/bulk-expire
Content-Type: application/json
```

요청 본문은 다음 selector 중 **정확히 하나**만 포함해야 합니다.

```json
{ "ids": ["550e8400-e29b-41d4-a716-446655440000"] }
```

```json
{ "older_than_days": 30 }
```

```json
{ "all_pending": true }
```

`ids`는 비어 있지 않은 UUID 배열, `older_than_days`는 1~3650의 정수여야 합니다. 두 endpoint 모두 현재 `pending`인 행만 변경하며, 이미 처리된 후보는 건너뜁니다.

```json
{
  "ok": true,
  "action": "dismiss",
  "matched": 12,
  "updated": 12,
  "timestamp": "2026-06-14T12:00:00.000Z"
}
```

- `matched`: selector와 `pending` 조건을 모두 충족한 행 수
- `updated`: 트랜잭션에서 실제 상태가 변경된 행 수
- `400`: selector 누락·중복 또는 값 형식 오류
- `500`: DB 미연결 또는 상태 변경 실패

##### 배치: 후보 선정·큐 갱신

```http
POST /admin/batch/run
Content-Type: application/json

{ "jobType": "memory_review_candidates" }
```

- 스케줄러에 등록된 주기(`BatchScheduler`의 `memory_review_candidates` 작업)로도 동일 로직이 실행됩니다.
- `jobType`으로 `cleanup`, `monitoring`, `memory_review_candidates` 등 허용된 값만 전달할 수 있습니다(잘못된 값은 400).

##### 환경 변수 (기억 리뷰 MVP)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MEMORY_REVIEW_IMPORTANCE_THRESHOLD` | `0.7` | 후보로 고려할 최소 importance (0~1; 잘못된 값은 기본값으로 대체) |
| `MEMORY_REVIEW_STALE_DAYS` | `14` | 최소 stale 일수 (정수 ≥ 1) |
| `MEMORY_REVIEW_MAX_CANDIDATES` | `50` | 선정 단계에서 반환·큐에 반영할 최대 후보 수 (정수 ≥ 1) |
| `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS` | `86400000` (24h) | 배치 `memory_review_candidates` 스케줄 간격(ms). 최소 `60000` |
| `MEMORY_REVIEW_CANDIDATE_DUE_DAYS` | `14` | 배치가 `due_at`을 계산할 때 기준 시각에 더하는 일 수 (1~366) |

운영 시 **후보 선정 민감도**는 위 표의 앞 세 변수로, **스케줄 간격·마감 시각**은 마지막 두 변수로 조정합니다.

대시보드 **Review Queue** 탭의 백그라운드 폴링은 HTTP 서버가 `GET /dashboard` HTML에 `window.__MEMENTO_REVIEW_QUEUE__`를 인라인으로 주입해 적용합니다(GitHub #274).

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS` | `60000` | 성공한 폴링 사이의 대기 시간(ms). 잘못된 값·미설정은 `60000`과 동일하게 취급. 서버는 **10000**~**86400000**(1일)로 클램프 |
| `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS` | (비어 있음) | 연속 폴링 실패 시 대기(ms). 쉼표 구분 목록(예: `60000,120000`). 비어 있으면 실패 후에도 성공 시와 동일 간격(`MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS`)으로만 재시도. 각 값도 **10000**~**86400000**로 클램프 |

**권장:** 운영에서는 기본 60초를 유지하거나 늘리고, 오류 시에만 완만한 백오프를 두려면 `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS=60000,120000`처럼 설정합니다(배치 `memory_review_candidates`와 혼동하지 말 것).



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

### HTTP API로 이동된 도구 (Phase 5.3)

다음 4개 도구는 관리/운영성 기능으로 분류되어 HTTP API로만 제공됩니다:

- `restore_anchors` - 앵커 복원 → `POST /admin/anchors/restore`
- `migrate_embeddings` - 임베딩 마이그레이션 → `POST /admin/embeddings/migrate`
- `convert_episodic_to_semantic` - Episodic → Semantic 변환 → `POST /admin/memory/convert-episodic-to-semantic`
- `get_meta_memory_stats` - 메타 메모리 통계 조회 → `GET /admin/memory/meta-stats`

자세한 내용은 [관리자 API](#관리자-api) 섹션을 참조하세요.

### 기타 제거된 도구

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
- **Node.js**: 24+

### 마이그레이션 가이드

버전 업그레이드 시 변경사항은 [CHANGELOG.md](../../../CHANGELOG.md)를 참조하세요.
