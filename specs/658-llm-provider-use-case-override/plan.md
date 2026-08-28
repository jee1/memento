# Implementation Plan: LLM Provider Use-Case Override

**Branch**: `jee1/feat-config-llm-provider-use-case-override-cross` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/658-llm-provider-use-case-override/spec.md`
**Issue**: [#820](https://github.com/jee1/memento/issues/820)

**Note**: `setup-plan.sh --json` failed branch naming gate (`jee1/feat-...` lacks `NNN-` prefix). Paths resolved from `.specify/feature.json` → `specs/658-llm-provider-use-case-override/`.

## Summary

Add per-job LLM **provider** preferences for `triple_extraction`, `relation_extraction`, and `procedural` by mirroring the existing `llmModelOverrides` / `LLM_MODEL_*` pattern (`LLM_PROVIDER_TRIPLE_EXTRACTION` / `_RELATION_EXTRACTION` / `_PROCEDURAL`). Wire the three call sites to `resolveLlmProvider(useCase)` instead of global-only / hard-coded selection. Fix cross-provider model leak in `resolveLlmModel` so a use-case model override applies only when runtime provider equals the **bound** provider (FR-004). Extend Ollama readiness when any in-scope override selects `ollama` (FR-005). Document in `env.example` + ko/en guides. Consolidation and personal-agent remain out of scope.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: `@memento/core` config + `LLMClientInitializer`, existing OpenAI/Gemini/Ollama clients, Zod (unchanged), Vitest  
**Storage**: N/A (configuration / call-path only; no DB migration)  
**Testing**: Vitest — unit tests on resolver + FR-004 discard; extend existing `llm-model-resolver.spec.ts`, `llm-client-initializer/*`, and call-site `determineProvider` suites as needed  
**Target Platform**: Node MCP server / HTTP admin (same as today)  
**Project Type**: Monorepo library + MCP server (`packages/memento-core`, docs, `env.example`)  
**Performance Goals**: No new latency budget; per-invocation resolution O(1); invalid-provider warn ≤1× per setting at init  
**Constraints**: Backward-compatible defaults when overrides unset; no MCP/HTTP API surface change; no hard-pin mode; no new model↔provider name validator (FR-019); restart-same-as-other-LLM-env (no hot-reload)  
**Scale/Scope**: 3 use cases, 3 new env keys, ~1 shared resolver module + initializer gate + 3 call sites + docs/tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First | PASS | FR-004 model-binding and resolveLlmProvider invalid/empty paths require failing tests first |
| II. Backward Compatibility | PASS | Unset overrides → existing global behavior; MCP tool contracts unchanged (FR-009) |
| III. Schema / Migration | PASS | No schema change |
| IV. Quality Gates | PASS (at completion) | lint / type-check / test + graphify rebuild after production code |
| V. Observability / Isolation | PASS | FR-010/014/016 warnings/logs; FR-018 no primary-path abort on local readiness fail |
| Additional: security scope | PASS | Env/config keys only; no new auth endpoints |
| Additional: LoCoMo | N/A | No corpus involvement |

**Post-design re-check**: Still PASS — contracts are env/docs only; design introduces no schema, no MCP break, and keeps prefer-then-fallback.

## Project Structure

### Documentation (this feature)

```text
specs/658-llm-provider-use-case-override/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (env/config contract)
├── progress.yml
├── spec.md
└── tasks.md             # Phase 2 (/speckit.tasks — not this command)
```

### Source Code (repository root)

```text
packages/memento-core/src/shared/
├── types/memory.types.ts              # + llmProviderOverrides
├── config/
│   ├── index.ts                       # env → llmProviderOverrides (3 keys)
│   ├── llm-model-resolver.ts          # + resolveLlmProvider; FR-004 in resolveLlmModel
│   └── __tests__/llm-model-resolver.spec.ts
├── services/
│   └── llm-client-initializer.ts      # Ollama readiness if any override = ollama
└── utils/                             # optional: shared normalize/validate provider token

packages/memento-core/src/domains/
├── relation/services/triple-extraction/triple-extraction-service.ts
├── relation/services/llm-based-relation-extractor.ts
└── memory/procedural/procedural-llm-extractor.ts

env.example
docs/guides/ko/llm-provider-configuration.md
docs/guides/en/llm-provider-configuration.md
```

**Structure Decision**: Extend existing shared config/resolver and the three in-scope call sites inside `packages/memento-core`. No new package, no consolidation/personal-agent touch.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Implementation Phases (design intent for `/speckit.tasks`)

1. **Config + types** — `llmProviderOverrides`, normalize/validate (trim+lowercase; invalid→undefined + init warn), empty→unset.
2. **Resolvers** — `resolveLlmProvider(useCase)`; `resolveLlmModel` bound-provider guard + discard log (FR-004/016).
3. **Initializer** — Ollama connect test when any of the three overrides is `ollama` (FR-005/018).
4. **Call sites** — triple / relation / procedural pass `resolveLlmProvider(...)` into existing `determineProvider` paths.
5. **Docs** — `env.example` + ko/en guides (FR-006).
6. **Verify** — lint, type-check, targeted vitest, graphify rebuild.

## Setup note

`update-agent-context.sh` also uses `get_feature_paths` (branch-prefix). Agent context update for this plan uses `.specify/feature.json` path override / manual Recent Changes sync if the script cannot resolve `658-…`.
