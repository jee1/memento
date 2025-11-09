# tasks-0006-prd-anchor-system.md

## Relevant Files

- `src/database/migration/migrations/004-anchor-table.ts` - 앵커 테이블 생성 마이그레이션
- `src/services/anchor-manager.ts` - AnchorManager 서비스 클래스 (신규 생성)
- `src/services/anchor-manager.spec.ts` - AnchorManager 단위 테스트
- `src/tools/set-anchor-tool.ts` - set_anchor MCP 도구 (신규 생성)
- `src/tools/set-anchor-tool.spec.ts` - set_anchor 도구 단위 테스트
- `src/tools/get-anchor-tool.ts` - get_anchor MCP 도구 (신규 생성)
- `src/tools/get-anchor-tool.spec.ts` - get_anchor 도구 단위 테스트
- `src/tools/search-local-tool.ts` - search_local MCP 도구 (신규 생성)
- `src/tools/search-local-tool.spec.ts` - search_local 도구 단위 테스트
- `src/tools/clear-anchor-tool.ts` - clear_anchor MCP 도구 (신규 생성)
- `src/tools/clear-anchor-tool.spec.ts` - clear_anchor 도구 단위 테스트
- `src/tools/restore-anchors-tool.ts` - restore_anchors MCP 도구 (신규 생성, 선택적)
- `src/tools/restore-anchors-tool.spec.ts` - restore_anchors 도구 단위 테스트
- `src/tools/index.ts` - 도구 레지스트리에 새 도구들 등록
- `src/server/bootstrap.ts` - AnchorManager 서비스 초기화 추가
- `src/tools/types.ts` - ToolContext에 anchorManager 서비스 타입 추가
- `src/algorithms/local-search-engine.ts` - 국소 검색 알고리즘 구현 (신규 생성, 선택적)
- `src/algorithms/local-search-engine.spec.ts` - 국소 검색 엔진 단위 테스트
- `src/test/test-anchor-system.ts` - 앵커 시스템 통합 테스트
- `static/dashboard.html` - 대시보드 HTML 페이지 (신규 생성)
- `static/js/anchor-map.js` - Anchor Map 시각화 JavaScript (신규 생성, D3.js 또는 vis.js 사용)
- `static/css/dashboard.css` - 대시보드 스타일시트 (신규 생성)
- `src/server/http-server.ts` - 대시보드 라우트 및 Anchor Map API 엔드포인트 추가

### Notes

- 단위 테스트는 각 파일과 같은 디렉토리에 `.spec.ts` 확장자로 작성
- 통합 테스트는 `src/test/` 디렉토리에 작성
- `npm test`로 모든 테스트 실행 가능
- 기존 테스트가 모두 통과하는지 확인 필수
- 마이그레이션은 `src/database/migration/migrations/` 디렉토리에 `Migration` 인터페이스를 구현하여 생성

## Tasks

- [x] 1.0 데이터베이스 스키마 및 마이그레이션 구현
  - [x] 1.1 `src/database/migration/migrations/004-anchor-table.ts` 파일 생성 및 Migration 인터페이스 구현
  - [x] 1.2 `anchor` 테이블 생성 SQL 작성 (agent_id, slot, memory_id, created_at, updated_at, UNIQUE 제약) - 1.1에서 구현됨
  - [x] 1.3 인덱스 생성 SQL 작성 (idx_anchor_agent_slot, idx_anchor_memory_id, idx_anchor_agent_memory) - 1.1에서 구현됨
  - [x] 1.4 `validateBefore` 메서드 구현 (memory_item 테이블 존재 확인, 중복 마이그레이션 방지) - 1.1에서 구현됨
  - [x] 1.5 `validateAfter` 메서드 구현 (테이블 및 인덱스 생성 확인) - 1.1에서 구현됨
  - [x] 1.6 `up` 메서드 구현 (테이블 및 인덱스 생성) - 1.1에서 구현됨
  - [x] 1.7 `down` 메서드 구현 (롤백 로직: 테이블 및 인덱스 삭제) - 1.1에서 구현됨
  - [x] 1.8 마이그레이션 단위 테스트 작성 (`004-anchor-table.spec.ts`)
  - [x] 1.9 마이그레이션 실행 및 검증 (기존 데이터 호환성 확인) - 테스트 21개 모두 통과

- [x] 2.0 AnchorManager 서비스 구현
  - [x] 2.1 `src/services/anchor-manager.ts` 파일 생성 및 기본 클래스 구조 작성
  - [x] 2.2 타입 정의 추가 (AnchorInfo, AnchorSlot, SearchOptions, SearchResult 인터페이스) - 2.1에서 구현됨
  - [x] 2.3 메모리 캐시 구현 (`Map<string, {A: string | null, B: string | null, C: string | null}>`) - 2.1에서 구현됨
  - [x] 2.4 슬롯별 설정 상수 정의 (hop_limit, vector_threshold: A=1/0.8, B=2/0.6, C=3/0.4) - 2.1에서 구현됨
  - [x] 2.5 `setAnchor` 메서드 구현 (DB 저장 + 캐시 동기화, 중복 memory_id 검증) - 2.1에서 구현됨
  - [x] 2.6 `getAnchor` 메서드 구현 (캐시 우선, 없으면 DB 조회 후 캐시 업데이트) - 2.1에서 구현됨
  - [x] 2.7 `clearAnchor` 메서드 구현 (DB 삭제 + 캐시 동기화) - 2.1에서 구현됨
  - [x] 2.8 `restoreCacheFromDB` 메서드 구현 (서버 재시작 시 캐시 복원) - 2.1에서 구현됨
  - [x] 2.9 에러 처리 및 로깅 추가 - 2.1에서 구현됨 (AnchorError, MemoryNotFoundError, 에러 메시지 포함)
  - [x] 2.10 단위 테스트 작성 (`anchor-manager.spec.ts`): 캐시 동기화, 중복 검증, Edge Cases

- [ ] 3.0 국소 검색 알고리즘 구현
  - [ ] 3.1 `searchLocal` 메서드 기본 구조 구현 (AnchorManager 내부)
  - [ ] 3.2 앵커 메모리 임베딩 조회 로직 구현 (MemoryEmbeddingService 활용)
  - [ ] 3.3 1-hop 검색 구현 (앵커와 직접 유사한 메모리, cosine similarity > threshold)
  - [ ] 3.4 N-hop 검색 확장 구현 (재귀적 또는 반복적 hop 계산)
  - [ ] 3.5 `memory_link` 테이블 활용한 hop 계산 최적화 (선택적)
  - [ ] 3.6 쿼리 없이 검색 구현 (앵커 주변 모든 관련 메모리 반환)
  - [ ] 3.7 쿼리 기반 검색 구현 (앵커 주변에서 쿼리 관련 메모리 필터링)
  - [ ] 3.8 Fallback 메커니즘 구현 (query 있을 때만, min_results 미만 시 전역 검색)
  - [ ] 3.9 검색 결과 랭킹 구현 (hop 거리 기반 점수, 앵커 근처 부스트)
  - [ ] 3.10 결과 포맷팅 (local_results_count, fallback_used 플래그 포함)
  - [ ] 3.11 Edge Cases 처리 (앵커 없음, 임베딩 없음, 메모리 삭제)

- [ ] 4.0 MCP Tool 인터페이스 구현
  - [ ] 4.1 `src/tools/set-anchor-tool.ts` 생성 및 BaseTool 상속
  - [ ] 4.2 `set_anchor` 도구 입력 스키마 정의 (memory_id, slot, agent_id)
  - [ ] 4.3 `set_anchor` 핸들러 구현 (검증: 메모리 존재, 중복 방지, AnchorManager.setAnchor 호출)
  - [ ] 4.4 `src/tools/get-anchor-tool.ts` 생성 및 BaseTool 상속
  - [ ] 4.5 `get_anchor` 도구 입력 스키마 정의 (slot, agent_id 선택)
  - [ ] 4.6 `get_anchor` 핸들러 구현 (AnchorManager.getAnchor 호출)
  - [ ] 4.7 `src/tools/search-local-tool.ts` 생성 및 BaseTool 상속
  - [ ] 4.8 `search_local` 도구 입력 스키마 정의 (slot, query 선택, hop_limit, limit, agent_id)
  - [ ] 4.9 `search_local` 핸들러 구현 (AnchorManager.searchLocal 호출, fallback 처리)
  - [ ] 4.10 `src/tools/clear-anchor-tool.ts` 생성 및 BaseTool 상속
  - [ ] 4.11 `clear_anchor` 도구 입력 스키마 정의 (slot, agent_id 선택)
  - [ ] 4.12 `clear_anchor` 핸들러 구현 (AnchorManager.clearAnchor 호출)
  - [ ] 4.13 `src/tools/restore-anchors-tool.ts` 생성 및 BaseTool 상속 (선택적)
  - [ ] 4.14 `restore_anchors` 도구 입력 스키마 및 핸들러 구현
  - [ ] 4.15 `src/tools/index.ts`에 새 도구들 등록 (toolRegistry.registerAll)
  - [ ] 4.16 각 도구의 단위 테스트 작성 (set-anchor-tool.spec.ts, get-anchor-tool.spec.ts 등)

- [ ] 5.0 서비스 통합 및 테스트
  - [ ] 5.1 `src/tools/types.ts`에 ToolContext에 anchorManager 서비스 타입 추가
  - [ ] 5.2 `src/server/bootstrap.ts`에 AnchorManager 초기화 추가 (initializeServices 함수)
  - [ ] 5.3 `ServerServices` 인터페이스에 anchorManager 필드 추가
  - [ ] 5.4 `src/server/index.ts`의 ToolContext에 anchorManager 서비스 포함
  - [ ] 5.5 `src/server/http-server.ts`의 ToolContext에 anchorManager 서비스 포함
  - [ ] 5.6 통합 테스트 작성 (`src/test/test-anchor-system.ts`): 전체 워크플로우 검증
  - [ ] 5.7 멀티 클라이언트 시나리오 테스트 (여러 agent_id 동시 사용)
  - [ ] 5.8 Fallback 메커니즘 통합 테스트 (query 있을 때만 fallback)
  - [ ] 5.9 자동 앵커 이동 기능 구현 (선택적, MVP 이후 고려)
  - [ ] 5.10 기존 테스트 실행 및 통과 확인 (`npm test`)
  - [ ] 5.11 회귀 테스트 수행 (기존 기능 정상 동작 확인)

- [ ] 6.0 Anchor Map UI 구현 (대시보드 시각화)
  - [ ] 6.1 `src/server/http-server.ts`에 static 파일 서빙 미들웨어 추가 (`express.static('static')`)
  - [ ] 6.2 대시보드 라우트 추가 (`app.get('/dashboard', ...)`)
  - [ ] 6.3 Anchor Map API 엔드포인트 추가 (`GET /api/anchors/map?agent_id=...`)
  - [ ] 6.4 Anchor Map API 구현 (앵커 정보 + 관련 메모리 네트워크 데이터 반환)
  - [ ] 6.5 `static/dashboard.html` 생성 (기본 대시보드 구조, Anchor Map 섹션 포함)
  - [ ] 6.6 `static/css/dashboard.css` 생성 (대시보드 스타일, 반응형 디자인)
  - [ ] 6.7 `static/js/anchor-map.js` 생성 (네트워크 그래프 시각화 로직)
  - [ ] 6.8 D3.js 또는 vis.js 라이브러리 통합 (CDN 또는 로컬 파일)
  - [ ] 6.9 슬롯별 색상 구분 구현 (A: 빨강, B: 노랑, C: 파랑)
  - [ ] 6.10 Hop 거리에 따른 원형 레이어 표시 구현
  - [ ] 6.11 관련 메모리 간 연결선 표시 구현
  - [ ] 6.12 앵커 클릭 시 메모리 상세 정보 표시 기능 구현
  - [ ] 6.13 앵커 변경 버튼 및 인터랙션 구현
  - [ ] 6.14 검색 결과 하이라이트 기능 구현
  - [ ] 6.15 실시간 업데이트 (WebSocket 또는 polling) 구현 (선택적)
  - [ ] 6.16 UI 테스트 작성 (대시보드 접근, Anchor Map 렌더링 검증)
  - [ ] 6.17 반응형 디자인 테스트 (모바일/태블릿/데스크톱)

