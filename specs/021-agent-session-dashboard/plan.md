# Implementation Plan: Agent Session Dashboard

**Branch**: `feature/issue-460-agent-session-dashboard`
**Date**: 2026-06-07
**Spec**: [spec.md](./spec.md)

## Summary

기존 agent lifecycle persistence와 programmatic API를 확장해 session 운영 read model, provenance/injection detail, atomic JSONL import를 제공하고 dashboard tab에서 탐색한다.

## Constitution Check

- Test-First: API/import/UI contract failing tests를 먼저 추가한다.
- Backward Compatibility: 기존 route와 DTO 필드는 유지하고 additive route/field만 추가한다.
- Schema Discipline: 신규 schema 없음.
- Quality Gates: lint, type-check, targeted/full relevant tests, security workflow scripts.
- Failure Isolation: dashboard는 explicit error/degraded state, import는 no-write rollback.

## Architecture

### Core

- repository interface/type에 session page와 aggregate read model 추가
- SQLite repository에 stable cursor queries와 grouped aggregate 추가
- lifecycle service에 read delegation 추가

### Server

- `agent.routes.ts` safe DTO와 additive routes 확장
- transcript parser/validator/import helper를 별도 module로 분리
- injection telemetry read helper를 별도 module로 분리
- 모든 route는 기존 `/api/v1/agent` programmatic auth mount 재사용

### Dashboard

- `dashboard.html`에 Agent Sessions tab/panel 추가
- `dashboard-tabs.js` activation 추가
- `agent-sessions-panel*.js`를 shared/data/render/init 역할로 분리
- `dashboard.css`에 token 기반 상태/timeline/import 스타일 추가

## API Additions

- `GET /api/v1/agent/sessions`
- `GET /api/v1/agent/sessions/aggregate`
- `GET /api/v1/agent/sessions/:id/injections`
- `GET /api/v1/agent/provenance/detail`
- `POST /api/v1/agent/transcripts/import`

기존:

- `GET /sessions/:id`
- `GET /sessions/:id/observations`

에는 safe additive fields만 추가한다.

## Test Strategy

1. repository cursor/session aggregate tests
2. route tests for filters, pagination, redaction-safe DTO, provenance and injection joins
3. transcript dry-run, invalid no-write, conflict rollback, duplicate no-write, sensitive drop tests
4. dashboard static contract tests for tab, auth header, states, tokens, no raw payload rendering
5. programmatic auth integration test for new routes
6. security-check workflow commands

## Risks

- telemetry JSON corruption: malformed rows are skipped and response marks degraded.
- nested transaction behavior: rollback test proves zero partial writes.
- dashboard API key handling: memory-only variable, no storage/logging/DOM reflection.
- large session performance: bounded page size and grouped page aggregates.
