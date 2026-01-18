# Phase 7.1: ToolContext 생성 로직 중복 위치 분석

## 분석 목적
ToolContext 생성 로직의 중복 위치를 파악하여 팩토리 함수로 통일

## 분석 결과

### 1. 표준 팩토리 함수 (이미 존재)
- **위치**: `src/server/context.ts`
- **시그니처**: `createToolContext(serverContext: ServerContext): ToolContext`
- **특징**: ServerContext를 받아서 ToolContext 생성, 모든 서비스 포함 (최신 버전)

### 2. 직접 객체 생성 (2곳)
1. **`src/server/index.ts`** (423-441줄)
   - 직접 객체 생성
   - 일부 서비스 누락: `metaMemoryService`, `relationGraph` 등
   - **문제**: 서비스 추가 시 수동으로 업데이트 필요

2. **`src/server/http-server.ts`** (403-418줄)
   - 직접 객체 생성
   - 일부 서비스 누락: `metaMemoryService`, `relationGraph`, `failureDetector`, `reflexionWorker` 등
   - **문제**: 서비스 추가 시 수동으로 업데이트 필요

### 3. 로컬 createToolContext 함수 정의 (6곳)
1. **`src/test/test-tool-consistency.ts`** (16-32줄)
   - 시그니처: `(db: Database.Database, services: ServerServices): ToolContext`
   - 서비스 일부 누락

2. **`src/test/test-regression.ts`** (17-33줄)
   - 시그니처: `(db: Database.Database, services: ReturnType<typeof initializeServices> extends Promise<infer T> ? T : never): ToolContext`
   - 서비스 일부 누락

3. **`src/test/test-single-provider-regression.ts`** (33-49줄)
   - 시그니처: `(db: Database.Database, services: Awaited<ReturnType<typeof initializeServices>>): ToolContext`
   - 서비스 일부 누락

4. **`src/test/test-anchor-system.ts`** (16-33줄)
   - 시그니처: `(db: Database.Database, services: ServerServices): ToolContext`
   - anchorManager 포함

5. **`src/test/test-reflexion-e2e.spec.ts`** (21-38줄)
   - 시그니처: `(db: Database.Database, services: ServerServices): ToolContext`
   - anchorManager 포함

6. **`scripts/save-work-memory.ts`** (14-30줄)
   - 시그니처: `(db: Database.Database, services: Awaited<ReturnType<typeof initializeServices>>): ToolContext`
   - 서비스 일부 누락

### 4. 이미 표준 함수 사용 중 (3곳)
- `src/server/routes/mcp.routes.ts` (224줄)
- `src/server/routes/admin.routes.ts` (여러 곳)
- `src/server/middleware/tool-context.middleware.ts` (53줄)

## 문제점
1. **중복 코드**: 동일한 로직이 8곳에 중복 정의됨
2. **서비스 누락**: 직접 생성 및 로컬 함수에서 최신 서비스 누락 가능
3. **유지보수 어려움**: 서비스 추가 시 여러 곳 수정 필요
4. **일관성 부족**: 각 파일마다 다른 서비스 집합 포함

## 해결 방안
1. 표준 `createToolContext` 함수에 오버로드 추가: `(db, services)` 형태 지원
2. 모든 직접 생성 및 로컬 함수를 표준 함수로 교체
3. 테스트 파일에서도 표준 함수 사용하도록 통일

## 다음 단계
- [ ] 7.2: createToolContext 팩토리 함수 오버로드 추가 및 테스트 작성
- [ ] 7.3: createToolContext 팩토리 함수 구현
- [ ] 7.4: 모든 ToolContext 생성 로직을 팩토리 함수로 교체
