# Recall performance tuning

**Related**: [Issue #57](https://github.com/jee1/memento/issues/57) Phase 2 B (performance).

## Profiling

- **Env**: `MEMENTO_RECALL_PROFILE=1` logs `recall_profile` and `total_ms` on successful recall for tuning.
- Default: off.

## Indexes (Procedural version)

- **Migration 014** added indexes for procedural version chain and latest-version queries to improve recall with `version_filter`.

For full index names and tuning tips, see the [Korean version](../ko/recall-performance-tuning.md).
