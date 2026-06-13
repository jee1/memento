# Implementation Plan: Issue #446

**Branch**: `024-fix-relation-validation-timeout`

## Changes

- `relation-validator-executor.ts`: repo root, tsx binary, rule default
- `batch-scheduler-default-config.ts`: 30min env default
- `batch-scheduler-consolidation-relation-handlers.ts`: timeout → warn
