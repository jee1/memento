# Agent Integration Release Gate

이 게이트는 #452의 출시 KPI를 SQLite 감사 결과와 독립 실행 evidence로 검증한다.
측정 표본이 없는 항목은 성공으로 간주하지 않고 `insufficient_evidence`로 실패한다.

## 실행

```bash
npm run quality:agent-integration:release-gate -- \
  --db data/memory.db \
  --evidence /path/to/release-evidence.json \
  --output /tmp/agent-integration-release-gate.json
```

evidence 파일 형식:

```json
{
  "hook_return_latency_ms": [12, 18, 24],
  "agent_attempts": 3,
  "agent_unblocked_attempts": 3,
  "queue_dropped_count": 0,
  "secret_fixtures": ["unique-release-secret"],
  "regressions": {
    "benchmark_v3": true,
    "mcp_tools": true,
    "assistant": true
  }
}
```

`regressions` 값은 실제 명령이 성공한 뒤에만 `true`로 기록한다. #483의 외부 judge와
#484의 실제 독립 서버·agent session이 실행되지 않은 상태에서는 관련 evidence를 만들지 않는다.

## 판정 항목

- lifecycle capture success rate 99% 이상
- summary/promotion 파생 기억 provenance coverage 100%
- secret fixture DB payload, memory, telemetry 검출 0건
- hook return p95 50ms 이하
- session-start/pre-compact injection p95 1,500ms 이하
- injection token budget 초과 0건
- queue drop 0건
- 중복 adapter/event row 0건
- 장애 시 agent unblocked rate 100%
- benchmark-v3, MCP 도구, `@jee1/memento-assistant` 회귀 모두 통과
