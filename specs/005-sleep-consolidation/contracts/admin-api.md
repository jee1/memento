# Contract: Sleep Consolidation Admin API

**Feature**: `005-sleep-consolidation` | **Date**: 2026-03-28

## Endpoint

### `POST /admin/consolidation/run`

Sleep Consolidation 배치를 즉시 수동 실행한다. 완료까지 동기 대기.

**Request**

```http
POST /admin/consolidation/run
Content-Type: application/json

{
  "dryRun": false,          // optional, default: false. true이면 실제 변경 없이 클러스터만 탐색
  "ownerIdFilter": "agent-1" // optional. 특정 owner_id만 대상으로 실행
}
```

**Response 200 — 성공**

```json
{
  "success": true,
  "result": {
    "runAt": "2026-03-28T03:00:00.000Z",
    "durationMs": 4523,
    "clustersFound": 12,
    "clustersProcessed": 10,
    "clustersSkipped": 2,
    "semanticsCreated": 10,
    "episodicsConsolidated": 47,
    "errors": []
  }
}
```

**Response 200 — 부분 실패 (FR-009)**

```json
{
  "success": true,
  "result": {
    "runAt": "2026-03-28T03:00:00.000Z",
    "durationMs": 3100,
    "clustersFound": 12,
    "clustersProcessed": 9,
    "clustersSkipped": 3,
    "semanticsCreated": 9,
    "episodicsConsolidated": 41,
    "errors": [
      { "clusterId": "cluster-7", "error": "LLM API timeout" }
    ]
  }
}
```

**Response 409 — 이미 실행 중**

```json
{
  "success": false,
  "error": "Consolidation already running"
}
```

**Response 500 — 전체 실패**

```json
{
  "success": false,
  "error": "Consolidation failed: <message>"
}
```

---

## Backward Compatibility

- 기존 admin API 엔드포인트 변경 없음 (Constitution II 준수)
- `/admin/batch/run` 엔드포인트는 기존대로 유지, 새 엔드포인트는 추가만

---

## MCP Tools

Sleep Consolidation은 MCP tool로 노출하지 않는다 (admin-only 기능, CLAUDE.md HTTP-only admin 원칙 준수).
