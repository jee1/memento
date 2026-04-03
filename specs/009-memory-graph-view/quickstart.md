# Quickstart: 기억 관계 그래프 뷰

**Feature**: 009-memory-graph-view  
**Date**: 2026-04-02

## 개발 환경

```bash
# 1. 브랜치 확인
git checkout 009-memory-graph-view

# 2. 의존성 설치 (이미 설치된 경우 skip)
npm install

# 3. HTTP 서버 개발 모드 실행
npm run dev:http
# → http://localhost:3000 에서 서버 시작

# 4. 그래프 UI 접근
open http://localhost:3000/graph

# 5. API 직접 테스트
curl "http://localhost:3000/admin/graph" -H "x-admin-api-key: YOUR_KEY"
curl "http://localhost:3000/admin/graph?types=episodic,semantic&min_importance=0.3"
```

## 구현 순서 (TDD)

### Step 1: 데이터 변환 함수 단위 테스트 작성

`packages/memento-server/src/server/routes/admin.routes.spec.ts`에 그래프 데이터 변환 테스트 추가:

```typescript
describe('GET /admin/graph', () => {
  it('should return nodes and edges', ...)
  it('should filter by type', ...)
  it('should filter by min_importance', ...)
  it('should truncate at limit', ...)
  it('should return empty graph when no memories', ...)
})
```

### Step 2: `/admin/graph` 엔드포인트 구현

`packages/memento-server/src/server/routes/admin.routes.ts`에 라우트 추가.

### Step 3: UI 라우트 등록

`packages/memento-server/src/server/http-server.ts`에 `GET /graph` 라우트 추가.

### Step 4: 프론트엔드 구현

`static/graph.html` 생성 — D3.js v7 CDN 사용, force-directed 그래프.

### Step 5: 품질 게이트 통과

```bash
npm run lint
npm run type-check
npm test
```

## 핵심 파일 위치

| 파일 | 역할 |
|------|------|
| `packages/memento-server/src/server/routes/admin.routes.ts` | `/admin/graph` API 라우트 |
| `packages/memento-server/src/server/routes/admin.routes.spec.ts` | 엔드포인트 테스트 |
| `packages/memento-server/src/server/http-server.ts` | `/graph` UI 라우트 등록 |
| `static/graph.html` | force-directed 그래프 UI |
