# Implementation Plan: Agent Adapter Smoke Matrix

**Branch**: `feature/484-agent-smoke-matrix` | **Date**: 2026-06-13
**Spec**: `/specs/026-agent-adapter-smoke-matrix/spec.md`

## Summary

`scripts/agent-smoke-matrix.ts` runner와 Vitest spec, 운영 문서를 추가한다.
기존 `@memento/agent-integration` adapter/settings/runner와 `agent-ops` CLI를 재사용한다.
실제 agent prompt는 controlled runner env로 분리하고 CI는 fixture + probe 경로만 강제한다.

## Structure

```text
specs/026-agent-adapter-smoke-matrix/
scripts/agent-smoke-matrix.ts
scripts/agent-smoke-matrix.spec.ts
docs/operations/ko/agent-smoke-matrix.md
package.json  # quality:agent-smoke, quality:agent-smoke:test
```

## Verification

```bash
npm run quality:agent-smoke:test
npm run quality:agent-smoke -- --output test-results/agent-smoke-matrix.json
npm run lint && npm run type-check
```
