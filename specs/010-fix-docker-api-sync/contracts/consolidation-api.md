# Contract: Sleep Consolidation API 엔드포인트

**Feature**: 010-fix-docker-api-sync  
**Endpoint**: `POST /admin/consolidation/run`

---

## POST /admin/consolidation/run

에피소딕 메모리 → 시맨틱 메모리 Sleep Consolidation을 수동으로 실행한다.

### 요청

| 항목 | 값 |
|------|-----|
| Method | POST |
| Path | `/admin/consolidation/run` |
| Content-Type | `application/json` |
| Auth | 없음 (Admin API) |

**Request Body** (선택적):
```json
{
  "dryRun": true,
  "ownerIdFilter": "user-123"
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `dryRun` | boolean | 아니오 | `false` | `true` 시 실제 변경 없이 시뮬레이션 |
| `ownerIdFilter` | string | 아니오 | `null` (전체) | 특정 소유자만 대상 |

**빈 바디** 허용: `{}` 또는 바디 없음 → `dryRun: false`, `ownerIdFilter: null`

### 응답

#### 200 OK — 성공 (dryRun: true)
```json
{
  "success": true,
  "result": {
    "processed": 10,
    "consolidated": 3,
    "skipped": 7,
    "errors": 0,
    "dryRun": true
  }
}
```

#### 200 OK — 성공 (실제 실행)
```json
{
  "success": true,
  "result": {
    "processed": 10,
    "consolidated": 3,
    "skipped": 7,
    "errors": 0,
    "dryRun": false
  }
}
```

#### 409 Conflict — 이미 실행 중
```json
{
  "success": false,
  "error": "Consolidation already running"
}
```

#### 500 Internal Server Error — 서비스 미초기화
```json
{
  "success": false,
  "error": "Sleep consolidation not available"
}
```

#### 500 Internal Server Error — 실행 중 오류
```json
{
  "success": false,
  "error": "Consolidation failed: <error message>"
}
```

---

## 상태 전이

```
[대기] ──run() 호출──► [실행 중]
   ▲                      │
   │    성공/실패          │
   └──────────────────────┘

[대기] + run() 동시 호출 → ConsolidationAlreadyRunningError → HTTP 409
```

---

## 구현 메모

- `ConsolidationAlreadyRunningError`: `@memento/core`에서 import
- `SleepConsolidationService.run()` 시그니처:
  ```typescript
  run(opts: { dryRun: boolean; ownerIdFilter: string | null }): Promise<SleepConsolidationRunResult>
  ```
- `serverServices?.sleepConsolidationService` 미초기화 시 → HTTP 500 (서비스 미초기화)
- `dryRun: false` 실행 결과는 DB에 실제 반영됨 (취소 불가)
