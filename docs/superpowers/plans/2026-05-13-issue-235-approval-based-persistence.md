# Issue #235 Approval-Based Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-phase personal knowledge agent: `runOneTurn` assigns stable candidate ids without saving; `persistApprovedCandidates` saves only approved ids via `RememberTool`, returning per-candidate results.

**Architecture:** `KnowledgeCandidatePayload` (no id) from extractor; service assigns `kc_${uuid}`. `IPersistencePort.persistApproved` accepts `PersonalKnowledgePersistInput` and returns `PersonalKnowledgePersistResult`. `ToolContextRememberPersistenceAdapter` maps each candidate with `mapKnowledgeCandidateToRememberParams` and calls `new RememberTool().handle(params, context)`.

**Tech Stack:** TypeScript, Vitest, `better-sqlite3` ToolContext, existing `RememberTool` / `RememberParams`.

**Spec:** `docs/superpowers/specs/2026-05-13-issue-235-approval-based-persistence-design.md`

---

### Task 1: Types and extractor return type

**Files:**
- Modify: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/extractors/knowledge-candidate-extractor.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/extractors/knowledge-candidate-extractor.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/ports/context-port.ts` (if `proposeCandidates` types need payload vs full)

- [ ] Add `KnowledgeCandidatePayload = Omit<KnowledgeCandidate, 'id'>`, persist input/result types, `PersonalKnowledgePersistItemResult.status` without `skipped` in primary rows (only persisted|error per spec).
- [ ] Change extractor to return `KnowledgeCandidatePayload[]`; tests compare payloads without id or use helper.

---

### Task 2: Port + service + mapper + adapter

**Files:**
- Modify: `packages/memento-core/src/domains/personal-agent/ports/persistence-port.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts`
- Create: `packages/memento-core/src/domains/personal-agent/mappers/knowledge-candidate-to-remember-params.ts`
- Create: `packages/memento-core/src/domains/personal-agent/adapters/tool-context-remember-persistence-adapter.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`

---

### Task 3: Tests

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/mappers/knowledge-candidate-to-remember-params.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`

---

### Task 4: Verify

Run: `npm run type-check && npx vitest run packages/memento-core/src/domains/personal-agent`
