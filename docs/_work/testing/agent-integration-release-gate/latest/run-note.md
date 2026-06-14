# Agent Integration Release Gate (2026-06-14)

## Result

- Status: `pass`
- Capture success: 39/39 (100%)
- Provenance coverage: 9/9 derived memories (100%)
- Secret fixture leaks: 0
- Hook return p95: 37.58 ms across 20 actual hook calls
- Injection p95: 10 ms across 40 telemetry events
- Injection budget exceeded: 0
- Queue drops: 0
- Duplicate observations: 0
- Agent unblocked: 6/6 failure scenarios (100%)
- Regression suites: benchmark-v3, MCP server, and `@memento/assistant` passed

## Reproduction

1. Start an isolated Memento HTTP server with a disposable SQLite database.
2. Run the real Codex and Claude Code smoke matrix and retain its JSON report.
3. Dispatch actual hook events, including a unique credential fixture, and record return latencies.
4. Scan `agent_observation`, `memory_item`, and `telemetry_events` for the fixture.
5. Run benchmark-v3 review/category checks, MCP server tests, and the assistant suite.
6. Build an evidence JSON matching `ReleaseGateEvidence`, then run:

```bash
npm run quality:agent-integration:release-gate -- \
  --db /path/to/disposable.db \
  --evidence /path/to/evidence.json \
  --output /tmp/agent-integration-release-gate.json
```

The raw evidence file is intentionally not committed because it contains the unique secret fixture used for the zero-leak scan. The committed `report.json` contains only aggregate results.

## Audit Inputs

- Base commit: `4524fdadbbb059f5e356a181dbc1cfe65722f501`
- Disposable DB SHA-256: `9c3482f57c74b4ddf81b4ca5b4631d091d5ba5eeabe094d2c221da191c1c91a9`
- Raw evidence SHA-256: `9eabeea976e17c6057f78e70fa95ca94615f9f36dbf9c0778f31bf937b7afe8f`
- Live smoke report SHA-256: `b2803b9b8a0b027594fddeacf2103fc91fb970a2cbb98ddd9ea8fd181d7f9780`
- Redacted evidence fields and measured hook latencies: `evidence-summary.json`

The disposable DB and raw evidence are not published because they contain session payloads and the unique scan fixture. Their hashes bind the aggregate report to the measured inputs without publishing sensitive payloads.
## Notes

- The first credential fixture exposed an inline `api_key=value` redaction gap. A regression test and fail-closed assignment redaction fix were added before the final measurement.
- The final fixture had zero matches in observation payloads, memories, and telemetry.
- These measurements use a local isolated server and are a release gate, not long-running production SLO evidence.
