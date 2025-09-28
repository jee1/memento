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

## MCP Tools (핵심 5개만)

> **중요**: MCP 클라이언트는 핵심 메모리 관리 기능 5개만 노출합니다.  
> 관리 기능들은 HTTP API 엔드포인트로 분리되었습니다.  
> 자세한 내용은 [관리자 API](#관리자-api) 섹션을 참조하세요.

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

## 관리자 API

> **참고**: 다음 기능들은 MCP 클라이언트에서 제거되고 HTTP API 엔드포인트로 분리되었습니다.

### 메모리 관리 API

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
