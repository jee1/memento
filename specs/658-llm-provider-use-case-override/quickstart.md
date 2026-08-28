# Quickstart: Validate LLM provider use-case overrides

**Feature**: `specs/658-llm-provider-use-case-override`  
**Purpose**: Runnable checks that prove config resolution, FR-004 model binding, and Ollama readiness gating — without requiring a full production deploy.

## Prerequisites

- Node.js ≥24 (`nvm use` / `.nvmrc`)
- `npm install` completed in repo root
- Optional: live OpenAI/Gemini keys and/or local Ollama for end-to-end smoke; unit tests can mock clients

See also: [contracts/env-llm-provider-overrides.md](./contracts/env-llm-provider-overrides.md), [data-model.md](./data-model.md)

## 1. Unit — resolver & binding (required)

```bash
cd /home/jee1lee/orca/workspaces/memento/feat-config-llm-provider-use-case-override-cross
npm test -- packages/memento-core/src/shared/config/__tests__/llm-model-resolver.spec.ts
```

**Expect** (after implementation):

- Unset / empty / invalid provider override → falls through to global
- Normalization: `OpenAI` → `openai`
- Model override applied when `runtime === bound`
- Model override discarded (and discard observable) when `runtime !== bound`
- Empty model override → provider default

## 2. Unit — Ollama readiness when only job asks for local

```bash
npm test -- packages/memento-core/src/shared/services/__tests__/llm-client-initializer/
```

**Expect**: With global `LLM_PROVIDER=openai` (or cloud) and `LLM_PROVIDER_TRIPLE_EXTRACTION=ollama`, initializer path that performs Ollama connect test is exercised (mock OK). Failure does not throw out of primary init in a way that aborts MCP boot beyond existing behavior.

## 3. Regression — overrides unset

```bash
# Targeted call-site / provider suites as implemented in tasks
npm test -- packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.spec.ts
npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
```

**Expect**: With no `LLM_PROVIDER_*` job keys, selection matches pre-feature baselines for those suites.

## 4. Optional manual smoke (live providers)

```bash
export LLM_PROVIDER=openai
export LLM_PROVIDER_TRIPLE_EXTRACTION=ollama
# ensure Ollama up; OpenAI key present for other jobs
npm run dev   # or existing batch/job trigger for triple extraction
```

**Expect**: Triple path prefers Ollama when ready; other jobs stay on global; if Ollama down, existing fallback + no cross-provider model leak if `LLM_MODEL_TRIPLE_EXTRACTION` is set to an OpenAI-only id.

## 5. Docs check (SC-005)

Open:

- `env.example`
- `docs/guides/ko/llm-provider-configuration.md`
- `docs/guides/en/llm-provider-configuration.md`

Confirm the three keys, empty=unset, invalid→warn at init, prefer-then-fallback, and FR-004 binding/discard notes are present.

## 6. Quality gates (before claiming done)

```bash
npm run lint && npm run type-check && npm test
# after production code changes:
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

## Non-goals for this quickstart

- Consolidation provider override
- Personal-agent namespace changes
- Proposal B model matrix
- Full MCP schema changes
