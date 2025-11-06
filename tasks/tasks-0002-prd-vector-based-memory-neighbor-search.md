# Tasks: 벡터 기반 기억 이웃 탐색 및 추천 기능

이 문서는 `0002-prd-vector-based-memory-neighbor-search.md` PRD를 기반으로 생성된 구현 태스크 리스트입니다.

## Relevant Files

- `src/services/memory-neighbor-service.ts` - 이웃 기억 조회를 위한 핵심 비즈니스 로직 서비스
- `src/services/memory-neighbor-service.spec.ts` - MemoryNeighborService의 단위 테스트
- `src/tools/get-memory-neighbors-tool.ts` - MCP Tool 구현 (AI 에이전트용)
- `src/tools/get-memory-neighbors-tool.spec.ts` - GetMemoryNeighborsTool의 단위 테스트
- `src/server/http-server.ts` - HTTP API 엔드포인트 추가 (기존 파일 수정)
- `src/test/test-memory-neighbors.ts` - E2E 테스트 (MCP Tool 및 HTTP API 통합 테스트)
- `src/server/resources.ts` - MCP Resource 확장 (기존 파일 수정, 선택적)
- `src/tools/remember-tool.ts` - remember Tool 수정 (기존 파일 수정, 실시간 인접 기억 갱신 후크 추가)

### Notes

- 단위 테스트는 테스트 대상 파일과 같은 디렉토리에 위치합니다 (예: `memory-neighbor-service.ts`와 `memory-neighbor-service.spec.ts`).
- E2E 테스트는 `src/test/` 디렉토리에 위치합니다.
- 테스트 실행: `npm test` (모든 테스트) 또는 `npm test -- [파일경로]` (특정 파일만)
- 기존 `VectorSearchEngine`, `MemoryEmbeddingService`, `VectorSearchRepository`를 재사용합니다.
- **UI 구현은 이번 단계에서 제외됩니다 (최종 결정)**: PRD에 명시된 "기억 상세 화면 하단 유사한 기억 섹션" 등의 UI 구현은 포함하지 않으며, API만 제공합니다. UI는 향후 별도 작업으로 진행됩니다. (후속 태스크: `tasks-0003-prd-ui-memory-neighbors-display.md` 예정 또는 이슈 #ui-memory-neighbors 참조)

## Tasks

- [x] 1.0 Memory Neighbor Service 구현
  - [x] 1.1 `src/services/memory-neighbor-service.ts` 파일 생성 및 기본 클래스 구조 작성
  - [x] 1.2 `MemoryNeighborService` 클래스 생성: 생성자에서 `VectorSearchEngine`, `MemoryEmbeddingService` 의존성 주입
  - [x] 1.3 `getNeighbors` 메서드 구현: 메모리 ID를 받아 이웃 기억 조회하는 핵심 로직
  - [x] 1.4 메모리 ID 검증 로직: 존재하지 않는 memory_id에 대한 에러 처리 (`MemoryNotFoundError`)
  - [x] 1.5 임베딩 조회 로직: `MemoryEmbeddingService`를 통해 대상 기억의 임베딩 조회
  - [x] 1.6 임베딩이 없는 경우 처리: 빈 배열 반환 (경고 없이)
  - [x] 1.7 `VectorSearchEngine.search` 메서드를 활용하여 유사 기억 검색 (queryVector로 대상 기억의 임베딩 전달)
  - [x] 1.8 결과 필터링: 동일한 memory_id 제외, 유사도 임계값(threshold) 이상만 반환
  - [x] 1.9 응답 형식 구성: 이웃 기억 목록, 총 개수, 쿼리 실행 시간 포함
  - [x] 1.10 에러 처리: 예외 상황에 대한 적절한 에러 메시지 및 로깅
  - [x] 1.11 실시간 인접 기억 갱신 로직 구현 (필수): `updateNeighborsForNewMemory` 메서드 구현 - 새 기억 저장 시 기존 기억들과의 유사도 계산 및 인접 기억 목록 업데이트. PRD 3.1-3.3 요구사항에 따라 필수 구현. (참고: 2.9에서 remember Tool 후크와 연동)

- [x] 2.0 MCP Tool 구현
  - [x] 2.1 `src/tools/get-memory-neighbors-tool.ts` 파일 생성
  - [x] 2.2 `GetMemoryNeighborsTool` 클래스 생성: `BaseTool` 상속
  - [x] 2.3 Zod 스키마 정의: `memory_id` (required), `limit` (optional, default: 5), `similarity_threshold` (optional, default: 0.8)
  - [x] 2.4 `inputSchema` 정의: JSON Schema 형식으로 Tool 파라미터 스키마 작성
  - [x] 2.5 `handle` 메서드 구현: 파라미터 파싱 및 `MemoryNeighborService` 호출
  - [x] 2.6 Tool 응답 형식 구성: MCP Tool 표준 응답 형식 준수 (이웃 기억 목록, 총 개수, 쿼리 시간)
  - [x] 2.7 에러 처리: 존재하지 않는 memory_id, 서비스 오류 등에 대한 적절한 에러 응답
  - [x] 2.8 `src/tools/index.ts`에 Tool 등록: `GetMemoryNeighborsTool` 인스턴스 생성 및 `toolRegistry`에 등록
  - [x] 2.9 `remember` Tool 후크 추가 (필수): `src/tools/remember-tool.ts` 수정하여 새 기억 저장 후 `MemoryNeighborService.updateNeighborsForNewMemory`를 호출하여 인접 기억 목록 갱신. PRD 3.1-3.3 요구사항에 따라 필수 구현. 비동기 실행, 실패해도 메모리 저장은 성공하도록 처리. (1.11과 연동)

- [x] 3.0 HTTP API 엔드포인트 구현
  - [x] 3.1 `src/server/http-server.ts`에 `GET /memories/:id/neighbors` 엔드포인트 추가
  - [x] 3.2 쿼리 파라미터 파싱: `limit` (optional, default: 5), `similarity_threshold` (optional, default: 0.8)
  - [x] 3.3 URL 파라미터에서 `memory_id` 추출 (`:id`)
  - [x] 3.4 `MemoryNeighborService` 인스턴스 생성 또는 의존성 주입
  - [x] 3.5 서비스 호출 및 결과 처리
  - [x] 3.6 HTTP 응답 형식 구성: JSON 형식으로 `memory_id`, `neighbors` 배열, `total_count`, `query_time` 포함
  - [x] 3.7 에러 처리: 404 (메모리 없음), 500 (서버 오류) 등 적절한 HTTP 상태 코드 반환
  - [x] 3.8 CORS 및 미들웨어 설정 확인 (기존 설정 활용)

- [ ] 4.0 테스트 작성
  - [x] 4.1 `src/services/memory-neighbor-service.spec.ts` 생성: MemoryNeighborService 단위 테스트
  - [x] 4.2 서비스 테스트: 정상 케이스 (이웃 기억 조회 성공)
  - [x] 4.3 서비스 테스트: 존재하지 않는 memory_id 에러 처리
  - [x] 4.4 서비스 테스트: 임베딩이 없는 기억 처리 (빈 배열 반환)
  - [x] 4.5 서비스 테스트: 동일 기억 제외 로직 검증
  - [x] 4.6 서비스 테스트: 유사도 임계값 필터링 검증
  - [x] 4.7 `src/tools/get-memory-neighbors-tool.spec.ts` 생성: GetMemoryNeighborsTool 단위 테스트
  - [x] 4.8 Tool 테스트: 파라미터 검증 (필수/선택 파라미터)
  - [x] 4.9 Tool 테스트: 정상 실행 및 응답 형식 검증
  - [x] 4.10 Tool 테스트: 에러 케이스 처리 검증
  - [x] 4.11 `src/test/test-memory-neighbors.ts` 생성: E2E 테스트
  - [x] 4.12 E2E 테스트: MCP Tool을 통한 이웃 기억 조회 시나리오
  - [x] 4.13 E2E 테스트: HTTP API를 통한 이웃 기억 조회 시나리오
  - [x] 4.14 E2E 테스트: 성능 테스트 (100ms 이하 응답 시간 목표)

- [x] 5.0 MCP Resource 확장 (선택적)
  - [x] 5.1 `src/server/resources.ts` 파일 확인 및 수정 (또는 Resource 핸들러 위치 확인)
  - [x] 5.2 `memory/{id}` Resource 핸들러 수정: `neighbors` 필드 추가
  - [x] 5.3 쿼리 파라미터 지원: `include_neighbors` (optional, default: false)로 neighbors 포함 여부 제어
  - [x] 5.4 Resource 응답에 neighbors 배열 추가 (선택적)
  - [x] 5.5 Resource 테스트 작성 (선택적)

