# Implementation Plan: Epic #661 Phase 1–3

**Branch**: `048-661-epic-666-673`

## Architecture

### Phase 1 — Client UX & Relation API
- Extend `@memento/client` with recall→feedback helper
- Add `telemetry-feedback-quality-query` for helpful_rate aggregation
- Register existing relation tools in core registry

### Phase 2 — Ops & Audit
- `memory-jsonl-portability` service + CLI scripts with manifest checksum
- Migration `037-memory-forgetting-event` (audit-only, no FK cascade)
- Admin routes: `/admin/forgetting/events`, `/admin/telemetry/feedback`

### Phase 3 — Interop & Examples
- `source-uri` validation module with strict env flag
- `ExportMemoriesTool` for markdown/jsonl
- `apps/multi-agent-orchestration` reference template

## Test Strategy

- Unit: source-uri, export tool, feedback quality query
- Integration: recall source round-trip, forgetting event log, JSONL round-trip
- Registry: relation tools in getAllTools()

## Dependencies

- Existing: FeedbackTool, relation tools, telemetry_events, schema migrations
- No breaking MCP contract changes
