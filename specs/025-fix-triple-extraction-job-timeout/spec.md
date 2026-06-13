# Feature Specification: Triple Extraction Per-Memory Job Timeout

**Feature Branch**: `025-fix-triple-extraction-job-timeout`  
**Created**: 2026-06-13  
**Issue**: [#475](https://github.com/jee1/memento/issues/475)

## Requirements

- FR-001: `triple_extraction_*` jobs use `TRIPLE_EXTRACTION_JOB_TIMEOUT_MS` (default 30 min).
- FR-002: Other jobs keep generic `jobTimeout`.
- FR-003: Triple extraction job timeout logs at WARN, not ERROR (#446 pattern).
- FR-004: No immediate retry on triple extraction timeout (batch backoff handles retry).
- FR-005: Config validation min 1 second via `resolveValidatedNumber`.

## Success Criteria

- Per-memory triple extraction uses 30 min default timeout.
- No ERROR from 5 min generic coordinator timeout for these jobs.
- lint, type-check, test pass.
