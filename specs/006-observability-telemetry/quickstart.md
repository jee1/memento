# Quickstart: Observability & Telemetry

## 설치 후 빠른 확인

```bash
# 1. DB 마이그레이션 실행
npm run db:migrate -w @memento/core

# 2. 서버 실행
npm run dev:http

# 3. 테스트용 recall 요청 (MCP 클라이언트 또는 직접 테스트)
# recall이 발생하면 telemetry_events에 이벤트가 자동 기록됩니다

# 4. 검색 품질 지표 확인
curl http://localhost:3001/admin/telemetry/search-quality

# 5. 메모리 품질 지표 확인
curl http://localhost:3001/admin/telemetry/memory-quality

# 6. 시스템 성능 지표 확인
curl http://localhost:3001/admin/telemetry/system

# 7. 원시 이벤트 쿼리 (빈 결과 이벤트만)
curl "http://localhost:3001/admin/telemetry/events?event_type=memory.search.empty&limit=10"

# 8. 특정 request_id로 요청 흐름 추적
curl "http://localhost:3001/admin/telemetry/events?request_id={UUID}"
```

## 환경변수

```bash
# .env 예시
TELEMETRY_RETENTION_DAYS=90           # raw 이벤트 보존 기간 (기본값)
TELEMETRY_CLEANUP_INTERVAL_MS=86400000  # cleanup 잡 실행 간격 = 24시간 (기본값)
TELEMETRY_STORE_QUERY_PLAINTEXT=false   # query 전문 저장 여부 (기본 false = 해시만)
```

## 테스트 실행

```bash
# 텔레메트리 단위 테스트
npx vitest run packages/memento-core/src/domains/telemetry/

# 전체 테스트
npm test

# 시나리오 테스트
npm run test:search
```

## 주요 파일 위치

| 역할 | 경로 |
|------|------|
| 핵심 서비스 | `packages/memento-core/src/domains/telemetry/services/telemetry-service.ts` |
| DB 쿼리 | `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.ts` |
| Admin API | `packages/memento-server/src/server/routes/admin.routes.ts` (수정) |
| 타입 정의 | `packages/memento-core/src/domains/telemetry/types/telemetry.types.ts` |
| 마이그레이션 | `packages/memento-core/src/infrastructure/database/.../027-telemetry-events.ts` |
| Cleanup 잡 | `packages/memento-core/src/infrastructure/scheduler/jobs/telemetry-cleanup-batch-job.ts` |
