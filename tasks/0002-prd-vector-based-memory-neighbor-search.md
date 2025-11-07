# 0002-prd-vector-based-memory-neighbor-search.md

## Introduction/Overview

저장된 기억 간의 벡터 유사도를 기반으로 **"이 기억과 연관된 다른 기억"**을 자동으로 찾아 추천하는 기능입니다. 

현재 MCP 서버의 `recall` 도구는 검색 쿼리에 대한 결과만 반환하여, 사용자가 특정 기억을 조회할 때 의미적으로 유사한 기억들을 함께 확인하기 어렵습니다. 또한 AI 에이전트가 연관된 경험을 자동으로 참고하여 맥락적 응답을 생성하는 데 제한이 있습니다.

이 기능은 Kanerva의 "Sparse Distributed Memory" 개념을 반영하여, 기억이 인접 벡터로 연결된다는 아이디어를 구현합니다. 모든 기억은 저장 시 벡터 임베딩을 생성하며, 새로운 기억 저장 시 기존 벡터들과의 거리(cosine similarity)를 계산하여 인접 기억 목록을 실시간으로 업데이트합니다.

## Goals

1. **연관 기억 자동 추천**: 특정 기억 조회 시 유사도가 높은 기억들을 자동으로 제시하여 탐색 효율 향상
2. **에이전트 맥락 강화**: AI 에이전트가 연관 경험을 자동으로 참고하여 더 풍부한 맥락적 응답 생성 가능
3. **실시간 추천 시스템**: 기억 저장 시 즉시 인접 기억 목록을 업데이트하여 실시간 추천 제공
4. **고성능 벡터 검색**: 100ms 이하의 응답 시간으로 빠른 추천 제공
5. **의미적 유사도 기반**: 벡터 임베딩의 cosine similarity를 활용한 정확한 의미적 유사도 계산

## User Stories

### AI 에이전트 관점
- **US-001**: AI 에이전트로서 특정 기억을 조회할 때, 의미적으로 유사한 과거 기록들을 자동으로 함께 받아 맥락을 더 풍부하게 이해하고 싶다
- **US-002**: AI 에이전트로서 사용자의 질문에 답변할 때, 관련된 과거 경험을 자동으로 참고하여 더 정확하고 맥락적인 응답을 생성하고 싶다
- **US-003**: AI 에이전트로서 특정 주제나 태그 중심의 기억 클러스터를 탐색하여 관련 정보를 효율적으로 수집하고 싶다

### 개발자 관점
- **US-004**: 개발자로서 MCP 클라이언트에서 특정 기억의 이웃 기억을 조회하는 간단한 API를 사용하고 싶다
- **US-005**: 개발자로서 추천 시스템의 성능이 충분히 빠르게 동작하여 사용자 경험을 해치지 않기를 원한다

## Functional Requirements

### 1. MCP Tool 구현
1.1. `get_memory_neighbors` MCP Tool을 구현하여 특정 기억의 이웃 기억을 조회할 수 있도록 함
1.2. Tool 파라미터:
   - `memory_id` (required): 조회할 기억의 ID
   - `limit` (optional, default: 5): 반환할 이웃 기억의 최대 개수
   - `similarity_threshold` (optional, default: 0.8): 유사도 임계값 (0.0 ~ 1.0)
1.3. Tool 응답 형식:
   - 이웃 기억 목록 (메모리 ID, 내용, 유사도 점수 포함)
   - 총 이웃 기억 개수
   - 쿼리 실행 시간

### 2. 벡터 유사도 계산
2.1. 기존 `VectorSearchEngine`을 활용하여 cosine similarity 기반 유사도 계산
2.2. 유사도 임계값 0.8 이상인 기억만 반환
2.3. 동일한 기억(memory_id가 같은 경우)은 결과에서 제외
2.4. 임베딩이 없는 기억은 자동으로 제외

### 3. 실시간 인접 기억 업데이트
3.1. 새로운 기억 저장 시 (`remember` Tool 호출 시) 해당 기억의 임베딩 생성
3.2. 생성된 임베딩과 기존 모든 기억의 임베딩 간 cosine similarity 계산
3.3. 유사도가 임계값(0.8) 이상인 기억들을 인접 기억으로 식별
3.4. 인접 기억 정보를 데이터베이스에 저장 (선택적, 성능 최적화를 위해)

### 4. 데이터 범위 및 필터링
4.1. 모든 기억 타입(working, episodic, semantic, procedural)을 대상으로 검색
4.2. 기억 타입에 대한 필터링은 이번 단계에서 제외 (향후 확장 가능)
4.3. 태그 기반 필터링은 이번 단계에서 제외 (향후 확장 가능)

### 5. 성능 최적화
5.1. 벡터 검색 응답 시간 100ms 이하 목표
5.2. SQLite + sqlite-vec의 벡터 인덱스를 활용한 빠른 검색
5.3. 필요 시 인접 기억 정보를 캐싱하여 반복 조회 성능 향상 (선택적)

### 6. 에러 처리 및 엣지 케이스
6.1. 존재하지 않는 memory_id 조회 시 적절한 에러 메시지 반환
6.2. 임베딩이 없는 기억 조회 시 자동으로 제외하고 경고 없이 빈 결과 반환
6.3. 유사 기억이 없을 경우 빈 배열 반환 (에러 아님)
6.4. 동일한 기억이 결과에 포함되지 않도록 필터링

### 7. HTTP API 엔드포인트 구현
7.1. `GET /memories/:id/neighbors` 엔드포인트를 구현하여 HTTP를 통한 이웃 기억 조회 지원
7.2. 쿼리 파라미터:
   - `limit` (optional, default: 5): 반환할 이웃 기억의 최대 개수
   - `similarity_threshold` (optional, default: 0.8): 유사도 임계값 (0.0 ~ 1.0)
7.3. 응답 형식:
   ```json
   {
     "memory_id": "mem_xxx",
     "neighbors": [
       {
         "id": "mem_yyy",
         "content": "...",
         "type": "episodic",
         "similarity": 0.85,
         "created_at": "2025-01-01T00:00:00Z"
       }
     ],
     "total_count": 5,
     "query_time": 45
   }
   ```

### 8. MCP Resource 확장
8.1. `memory/{id}` Resource에 `neighbors` 필드를 추가하여 이웃 기억 정보 포함
8.2. Resource 조회 시 자동으로 이웃 기억 정보를 포함하여 반환 (선택적, 쿼리 파라미터로 제어)

### 9. UI 추천 영역 표시
9.1. 기억 상세 화면 하단에 "유사한 기억" 섹션 표시
9.2. 기본적으로 최대 5개의 유사 기억을 카드 형태로 표시
9.3. 각 카드에는 다음 정보 포함:
   - 기억 내용 미리보기 (최대 100자)
   - 유사도 점수 표시
   - 기억 타입 및 생성일
   - 클릭 시 해당 기억 상세 페이지로 이동
9.4. 유사 기억이 없을 경우 "유사한 기억이 없습니다" 메시지 표시
9.5. 로딩 상태 표시 (벡터 검색 중)

## Non-Goals (Out of Scope)

1. **클러스터링 및 시각화**: 기억 클러스터의 시각적 표현이나 클러스터 분석 기능
2. **추천 이유 설명**: 왜 특정 기억이 추천되었는지에 대한 설명 기능
3. **사용자 피드백 수집**: 추천된 기억에 대한 사용자 피드백(유용함/유용하지 않음) 수집 기능
4. **타입/태그 필터링**: 이번 단계에서는 모든 기억을 대상으로 검색 (필터링은 향후 확장)
5. **HNSW 인덱스**: 현재는 SQLite + sqlite-vec 사용, HNSW 인덱스는 향후 확장 고려
6. **배치 업데이트**: 실시간 업데이트만 지원, 배치 기반 인접 기억 갱신은 제외
7. **추천 순위 학습**: 사용 패턴을 학습하여 추천 순위를 개선하는 기능

## Design Considerations

### MCP Tool 설계
- **Tool 이름**: `get_memory_neighbors`
- **위치**: `src/tools/get-memory-neighbors-tool.ts`
- **의존성**: `VectorSearchEngine`, `MemoryEmbeddingService`
- **응답 형식**: 표준 MCP Tool 응답 형식 준수

### 벡터 검색 엔진 활용
- 기존 `VectorSearchEngine` 클래스의 `searchSimilar` 메서드 활용
- `VectorSearchRepository`를 통해 데이터베이스 접근
- cosine similarity 계산은 기존 알고리즘 재사용

### 데이터베이스 스키마
- 기존 `memory_embedding` 테이블 활용
- 인접 기억 정보를 별도 테이블에 저장할 필요는 없음 (실시간 계산)
- 성능 최적화가 필요한 경우 `memory_neighbors` 테이블 추가 고려 (선택적)

### 성능 고려사항
- 벡터 검색은 SQLite + sqlite-vec의 인덱스를 활용
- 대량의 기억이 있는 경우 성능 저하 가능성 있음 (향후 최적화 필요)
- 캐싱 전략은 필요 시 추가 (이번 단계에서는 제외)

## Technical Considerations

### 기존 컴포넌트 활용
- **VectorSearchEngine**: `src/algorithms/vector-search-engine.ts`
- **MemoryEmbeddingService**: `src/services/memory-embedding-service.ts`
- **VectorSearchRepository**: `src/repositories/vector-search.repository.ts`

### 구현 위치
- **MCP Tool**: `src/tools/get-memory-neighbors-tool.ts`
- **HTTP API**: `src/server/http-server.ts`에 엔드포인트 추가
- **서비스 로직**: `src/services/memory-neighbor-service.ts` (새로 생성)
- **테스트**: 
  - `src/tools/get-memory-neighbors-tool.spec.ts`
  - `src/services/memory-neighbor-service.spec.ts`
  - `src/test/test-memory-neighbors.ts` (E2E 테스트)

### API 엔드포인트
- **MCP Tool**: `get_memory_neighbors` (AI 에이전트용)
- **HTTP API**: `GET /memories/:id/neighbors` (웹 클라이언트/개발자용)
- 두 가지 인터페이스 모두 동일한 비즈니스 로직 공유

### 벡터 검색 파라미터
- **유사도 계산**: cosine similarity
- **임계값**: 0.8 (기본값, 조정 가능)
- **최대 결과 수**: 5개 (기본값, 조정 가능)

### 에러 처리
- 존재하지 않는 memory_id: `MemoryNotFoundError` 반환
- 임베딩 없음: 자동 제외, 경고 없음
- 유사 기억 없음: 빈 배열 반환 (정상 동작)

## Success Metrics

1. **기능 완성도**
   - `get_memory_neighbors` Tool 구현 완료: 100%
   - 모든 에지 케이스 처리: 100%

2. **성능 지표**
   - 평균 응답 시간: 100ms 이하
   - 95 백분위수 응답 시간: 200ms 이하
   - 동시 요청 처리: 단일 요청 기준 충족

3. **정확도 지표**
   - 유사도 계산 정확도: cosine similarity 기준 정확한 계산
   - 동일 기억 제외: 100% 정확도
   - 임베딩 없는 기억 제외: 100% 정확도

4. **사용성 지표**
   - MCP Tool 호출 성공률: 99% 이상
   - 에러 발생률: 1% 이하

## 📊 우선순위

- [x] **매우 중요 (핵심 기능)**: 이 기능은 Memento 프로젝트의 핵심 기능으로, 벡터 기반 기억 탐색의 기반이 됩니다.

## 🔗 관련 이슈

- `#core-memory-model`: 핵심 기억 모델과 연관된 기능
- `#vector-search`: 벡터 검색 엔진 및 임베딩 서비스와의 통합

## 📸 목업/스크린샷

### 기억 상세 화면 - 유사한 기억 섹션

```
┌─────────────────────────────────────────────────────────┐
│  기억 상세                                                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [기억 내용]                                              │
│  React Hook에 대해 학습했습니다. useState는 상태를 관리하고,│
│  useEffect는 사이드 이펙트를 처리합니다.                  │
│                                                          │
│  타입: episodic | 중요도: 0.8 | 생성일: 2025-01-01      │
│                                                          │
├─────────────────────────────────────────────────────────┤
│  유사한 기억 (5개)                                        │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐ │
│  │ 유사도: 0.92                                      │ │
│  │ React의 useState와 useEffect Hook 사용법을 정리했습니다.│ │
│  │ 타입: episodic | 2025-01-02                      │ │
│  └───────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 유사도: 0.88                                      │ │
│  │ JavaScript 함수형 프로그래밍과 React Hook 패턴... │ │
│  │ 타입: semantic | 2024-12-28                      │ │
│  └───────────────────────────────────────────────────┘ │
│  ... (3개 더)                                           │
└─────────────────────────────────────────────────────────┘
```

### API 응답 예시

**GET /memories/mem_xxx/neighbors?limit=5**

```json
{
  "memory_id": "mem_xxx",
  "neighbors": [
    {
      "id": "mem_yyy",
      "content": "React의 useState와 useEffect Hook 사용법을 정리했습니다.",
      "type": "episodic",
      "tags": ["react", "hooks"],
      "similarity": 0.92,
      "importance": 0.7,
      "created_at": "2025-01-02T10:00:00Z"
    },
    {
      "id": "mem_zzz",
      "content": "JavaScript 함수형 프로그래밍과 React Hook 패턴에 대해 학습했습니다.",
      "type": "semantic",
      "tags": ["javascript", "react"],
      "similarity": 0.88,
      "importance": 0.8,
      "created_at": "2024-12-28T15:30:00Z"
    }
  ],
  "total_count": 5,
  "query_time": 45
}
```

## Open Questions

1. **인접 기억 캐싱**: 실시간 계산 vs 사전 계산된 인접 기억 저장 - 성능 테스트 후 결정 필요
2. **대량 데이터 처리**: 수만 개 이상의 기억이 있는 경우 성능 저하 가능성 - 최적화 전략 필요
3. **유사도 임계값 조정**: 0.8이 적절한지 실제 사용 데이터로 검증 필요
4. **Resource 확장**: `memory/{id}` Resource에 neighbors 필드 추가 여부 결정 필요
5. **향후 확장성**: 타입/태그 필터링, 클러스터링 등 향후 기능 확장 계획 수립 필요
6. **UI 구현 범위**: 이번 단계에서 UI 구현까지 포함할지, API만 제공할지 결정 필요

