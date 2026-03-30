# Quickstart: Telemetry CLI & MCP Tool Access (007)

## CLI

```bash
# 전체 지표 조회 (24h 기준)
npm run telemetry

# 7일치 검색 품질만 조회
npm run telemetry -- --period 7d --type search-quality

# 메모리 품질만 조회
npm run telemetry -- --type memory-quality

# 도움말
npm run telemetry -- --help
```

**출력 예시**:
```
=== Memento Telemetry (24h) ===

[Search Quality]
  Total queries       : 42
  Avg latency         : 123 ms
  p95 latency         : 456 ms
  Empty result rate   : 12.5 %
  Avg candidate count : 8.3

[Memory Quality]
  Total memories      : 523
  Duplicate rate (24h): 2.1 %
  Orphan ratio        : 5.3 %
  Relation coverage   : 78.2 %

[System Metrics (24h)]
  Recall   - requests: 42  success: 40  error_rate: 4.8 %
  Remember - requests: 18  success: 18  error_rate: 0.0 %
  Feedback - requests:  3  success:  3  error_rate: 0.0 %
```

---

## MCP 도구

에이전트에서 호출:

```
get_telemetry_summary({ period: "24h" })
```

응답에는 호출한 에이전트의 `owner_id`로 필터링된 검색 품질 + 메모리 품질 지표가 포함된다.

---

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_PATH` | `./data/memory.db` | 텔레메트리 DB 파일 경로 |
