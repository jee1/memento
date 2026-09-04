# Research: #810 forgetting event retention

## Decision 1: Retention cutoff

**Decision**: JavaScript `toISOString()` cutoff + SQL `created_at < ?`
**Rationale**: Insert path uses ISO; avoids #804 shell date string trap.
**Alternatives considered**: `datetime('now', '-90 days')` — rejected for TZ clarity vs app clock.

## Decision 2: Batch job pattern

**Decision**: Clone `TelemetryCleanupBatchJob` structure
**Rationale**: Proven non-blocking failure + telemetry event optional.
**Alternatives**: Hook into `runMemoryCleanup` — rejected; different domain/lifecycle.

## Decision 3: Orphan forgetting events

**Decision**: Out of scope for retention job
**Rationale**: FR-006f in #804 uses explicit deleted ID list; time retention handles growth.

## Decision 4: Embedding gap / duplicates

**Decision**: Read-only report in CLI
**Rationale**: Issue asks root-cause first; auto-delete risks search regression.

## Decision 5: dimensions=0 cleanup

**Decision**: Operator CLI with preview default
**Rationale**: Matches #814 backup cleanup pattern; 4 known rows only.
