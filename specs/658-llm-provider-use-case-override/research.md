# Research: LLM Provider Use-Case Override

**Feature**: `specs/658-llm-provider-use-case-override`  
**Date**: 2026-08-27  
**Sources**: [spec.md](./spec.md), [#820](https://github.com/jee1/memento/issues/820), codebase (`llm-model-resolver.ts`, `LLMClientInitializer`, triple/relation/procedural call sites)

## R1 — Scope: three jobs vs issue’s four env keys

**Decision**: Implement provider overrides only for `triple_extraction`, `relation_extraction`, and `procedural`. Do **not** add `LLM_PROVIDER_CONSOLIDATION` in this feature.

**Rationale**: Spec FR-007 / Out of Scope defer consolidation until it shares `LLMClientInitializer`. Issue #820’s A안 listed consolidation env for completeness; product scope in the ratified spec excludes it.

**Alternatives considered**:
- Add consolidation env now but leave call site unchanged → dead config; rejected.
- Refactor consolidation in this PR → scope creep; rejected.

## R2 — Mirror `llmModelOverrides` for providers

**Decision**: Add `llmProviderOverrides: Partial<Record<InScopeLlmUseCase, LLMProvider>>` on `MementoConfig`, loaded from:

| Use case | Env key |
|----------|---------|
| `triple_extraction` | `LLM_PROVIDER_TRIPLE_EXTRACTION` |
| `relation_extraction` | `LLM_PROVIDER_RELATION_EXTRACTION` |
| `procedural` | `LLM_PROVIDER_PROCEDURAL` |

Add `resolveLlmProvider(useCase, config?)` returning the effective **requested** preference: valid override → that provider; else `config.llmProvider` (then `'auto'` as today).

**Rationale**: Matches Proposal A and existing `LLM_MODEL_*` naming; minimal operator learning.

**Alternatives considered**:
- Proposal B job×provider model matrix → deferred (spec Out of Scope).
- Personal-agent-style dedicated namespace → unnecessary; personal-agent stays separate.

## R3 — Provider token normalization & invalid values

**Decision**: Normalize override tokens with trim + lowercase before validity check. Allowed concrete/auto set = existing `LLMProvider`: `openai` | `gemini` | `ollama` | `auto`. Empty/whitespace → unset (omit). Unrecognized → treat as unset, emit `[CONFIG WARN]` (or existing config-warn channel via `process.stderr.write`) **once at config load** per bad key (FR-010/012/013/014). Do not abort startup.

**Rationale**: Align with global `LLM_PROVIDER` expectations and constitution Principle V / Security Check no-console guidance for config parsers.

**Alternatives considered**:
- Hard-fail process on invalid override → violates FR-010.
- Warn on every job invocation → log spam; rejected (FR-014).

## R4 — FR-004 bound provider vs issue sketch

**Decision**: Change `resolveLlmModel` so a non-empty use-case model override applies **only if** `runtimeProvider === boundProvider`. Call sites (or a thin helper) supply `boundProvider`:

1. Let `requested = resolveLlmProvider(useCase)` (after normalize / invalid→global).
2. If `requested` ∈ {`openai`,`gemini`,`ollama`} → `boundProvider = requested`.
3. If `requested === 'auto'` → `boundProvider =` process-level `LLMClientInitializationResult.preferredProvider` when available; if that is `null`, **do not apply** the use-case model override (use provider default for `runtimeProvider`) — safer than leaking a cloud model id to another provider.
4. On discard: structured log ≤1× per job invocation (FR-016); do not fail the job solely for discard.

**Rationale**: Issue #820 sketch only discarded when `llmProviderOverrides[useCase]` was set and differed — that misses model-only configs bound to global (spec Q1). Binding to concrete requested / init preferred closes the leak for auto+fallback.

**Alternatives considered**:
- Infer bound from model name heuristics → FR-019 forbids new model↔provider validator.
- Discard only when explicit job provider override set → fails User Story 2 for model-only + fallback.
- Hard-pin never-fallback → FR-017 forbids.

## R5 — Prefer-then-fallback at call sites

**Decision**: Replace global/hard-coded requested provider with `resolveLlmProvider(useCase)` fed into existing `determineProvider` / equivalent paths:

- `triple-extraction-service.ts` (and extractor helpers as needed)
- `llm-based-relation-extractor.ts`
- `procedural-llm-extractor.ts` (today hard-codes openai→gemini; must accept ollama when override/global says so via shared determine path)

Do **not** invent a never-fallback pin. Unavailable preferred → existing per-job fallback (FR-011/017).

**Rationale**: Spec prefer-then-fallback; reuse battle-tested determineProvider behavior.

**Alternatives considered**:
- New shared client factory per use case → larger refactor; YAGNI.
- Procedural remains openai/gemini-only → violates FR-001 when override is ollama.

## R6 — Ollama readiness gate

**Decision**: In `LLMClientInitializer.initialize`, run `testOllamaConnection` when:

- `selectedProvider === 'ollama'`, or
- `selectedProvider === 'auto'` and no cloud clients (existing), or
- **any** of the three `llmProviderOverrides` values normalizes to `ollama` (FR-005).

On readiness failure: existing unavailable/fallback behavior; do not abort primary MCP/memory path (FR-018).

**Rationale**: Cloud clients already init from API key presence; only Ollama needs connect test when solely job-scoped.

**Alternatives considered**:
- Lazy connect on first ollama job → larger behavior change; keep init-time parity with today.
- Force global `LLM_PROVIDER=ollama` → fails SC-004.

## R7 — Hot-reload / config effect

**Decision**: No new hot-reload. Same process-restart (or existing env reload) semantics as other LLM env vars (Q7).

**Rationale**: Spec / YAGNI.

## R8 — Contracts surface

**Decision**: Public contract for this feature is **environment / config documentation** (`contracts/env-llm-provider-overrides.md`), not MCP tools or HTTP APIs (FR-009).

**Rationale**: Configuration-only change; no request/response schema change.

## R9 — Testing strategy

**Decision**: Test-first on:

1. `resolveLlmProvider` — unset / empty / invalid / normalize / equals-global.
2. `resolveLlmModel` — apply when runtime===bound; discard+log when ≠; empty model unset; auto+null preferred skips override.
3. Initializer — ollama test invoked when only a job override is ollama.
4. Regression — unset overrides keep prior selection semantics for the three jobs (smoke/unit as practical).

**Rationale**: Constitution I; SC-003/SC-007 require automated FR-004 coverage.

## NEEDS CLARIFICATION

None remaining — brainstorm Q1–Q13 resolved; design choices above bind plan-level ambiguity.
