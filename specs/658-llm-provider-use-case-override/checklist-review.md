# Review Checklist: 658 LLM Provider Use-Case Override

**Date**: 2026-08-28  
**Scope**: Branch `jee1/feat-config-llm-provider-use-case-override-cross` (uncommitted)  
**Verdict**: **Approved after fixes** (2026-08-28)

## Fixes applied

1. Relation: `initializedProviders` stored; `isOllamaAvailable()` uses it.
2. Consolidation: per-branch `boundProvider` (`openai`/`gemini`) — no global `llmProvider` binding (FR-007).
3. Tests: relation job-override Ollama + `loadLlmProviderOverrideFromEnv` warn-once.

## Findings (confidence ≥ 80) — resolved unless noted

| Severity | Confidence | Location | Finding | Recommendation |
|----------|------------|----------|---------|----------------|
| Critical | 95 | `llm-based-relation-extractor.ts:190-207` | `isOllamaAvailable()` only checks `preferredProvider === 'ollama'`. With `LLM_PROVIDER=openai` + `LLM_PROVIDER_RELATION_EXTRACTION=ollama`, FR-005 readiness may pass but `determineProvider('ollama')` falls back to cloud. Triple/procedural use `initializedProviders.includes('ollama')`. | Store `initializedProviders` from init; set `providerAvailability().ollama` from that (match triple). |
| Important | 88 | `summarization-service.ts:60-98` | Out-of-scope consolidation gained FR-004 `boundProvider` logic. Can discard `LLM_MODEL_CONSOLIDATION` when runtime ≠ global bound → FR-007 / SC-006 risk. | Revert consolidation changes; keep FR-004 in-scope to 3 jobs only. |
| Important | 85 | (tests) | US2/SC-003/SC-004 lack call-site integration tests; relation Ollama job-override bug not caught. | Add relation job-override Ollama test + extractor-level FR-004 fallback test. |
| Important | 82 | `llm-provider-override.ts:24-36` | FR-014 warn-once implemented but no test for stderr + `warnedKeys` dedup. | Add unit test for `loadLlmProviderOverrideFromEnv`. |

## Spec compliance summary

| Area | Status |
|------|--------|
| FR-001/003/017 (relation + Ollama) | **Partial fail** |
| FR-004 (in-scope call sites) | Pass |
| FR-005/006/008/009/010/012/013/016/018/019 | Pass |
| FR-007 (consolidation untouched) | **Fail** |
| US1/US3 (relation Ollama) | **Gap** |
| US2 (model leak guard) | Pass at resolver; call-site E2E gap |
| US4 (docs) | Pass |

## Constitution

- **I Test-First**: relation Ollama gap should have been caught by integration test.
- **II Backward compat**: consolidation behavior change risk.
- **IV Quality gates**: lint/type-check/tests pass on touched units; graphify rebuilt in execute.

## Blockers before merge

1. Fix relation Ollama availability gate.
2. Revert or explicitly justify consolidation `summarization-service.ts` changes.

## Non-blocking follow-ups

- Call-site acceptance tests (SC-001/003/004).
- FR-014 stderr warn-once test.
- Split unrelated `.specify/` noise from feature PR if possible.
