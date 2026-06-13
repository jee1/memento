# Feature Specification: 주간 관계 검증 타임아웃

**Feature Branch**: `024-fix-relation-validation-timeout`  
**Created**: 2026-06-13  
**Issue**: #446 — Relation validation timeout after 300000ms

## Requirements

- FR-001: Repo root 기준 script/cwd spawn
- FR-002: 로컬 tsx 우선 실행
- FR-003: 기본 `--method rule --allow-soft-fail`
- FR-004: `WEEKLY_RELATION_VALIDATION_TIMEOUT_MS` 기본 30분
- FR-005: 타임아웃은 warn 로깅

## Success Criteria

- 타임아웃 ERROR 로그 제거 (warn으로 전환)
- 관련 Vitest·lint·type-check 통과
