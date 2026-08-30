# Data Model: LLM Provider Use-Case Override

**Feature**: `specs/658-llm-provider-use-case-override`  
**Date**: 2026-08-27  
**Persistence**: None (in-process config derived from env). No tables, migrations, or durable entities.

## Entities

### LlmUseCase (existing)

Discriminated string union used by model (and now provider) overrides.

| Value | In scope for provider override |
|-------|--------------------------------|
| `triple_extraction` | Yes |
| `relation_extraction` | Yes |
| `procedural` | Yes |
| `consolidation` | No (model override may still exist; provider override **not** added) |

### Canonical provider token

Normalized identifier after trim + lowercase.

| Token | Role |
|-------|------|
| `openai` | Concrete cloud provider |
| `gemini` | Concrete cloud provider |
| `ollama` | Concrete local provider |
| `auto` | Preference: existing auto-selection / fallback policy |

Invalid / unrecognized after normalize → treated as **unset** (not stored as a token).

### Global provider preference

- **Field**: `MementoConfig.llmProvider` (`LLM_PROVIDER`)
- **Type**: `LLMProvider` (`openai` \| `gemini` \| `ollama` \| `auto`)
- **Default**: `auto` when unset (existing)

### Per-job provider preference

- **Field**: `MementoConfig.llmProviderOverrides`
- **Type**: `Partial<Record<'triple_extraction' \| 'relation_extraction' \| 'procedural', LLMProvider>>`
- **Sources**:

| Key | Env |
|-----|-----|
| `triple_extraction` | `LLM_PROVIDER_TRIPLE_EXTRACTION` |
| `relation_extraction` | `LLM_PROVIDER_RELATION_EXTRACTION` |
| `procedural` | `LLM_PROVIDER_PROCEDURAL` |

### Per-job model preference (existing)

- **Field**: `MementoConfig.llmModelOverrides` (includes consolidation key; unchanged)
- Bound to a **Bound provider** for application (see below)

### Bound provider

Logical value for FR-004 (not necessarily a stored field):

1. If valid concrete per-job provider preference → that preference.
2. Else if global preference is concrete → that global preference.
3. Else (`auto`) → process `preferredProvider` from `LLMClientInitializer` when non-null; else no model override application.

### Runtime provider

Concrete provider actually used for one job invocation after `determineProvider` / equivalent (`openai` \| `gemini` \| `ollama`, or unavailable/`null`).

### Requested provider

Output of `resolveLlmProvider(useCase)`: override if valid, else global (possibly `auto`).

## Relationships

```text
env LLM_PROVIDER_* ──parse/normalize──► llmProviderOverrides[useCase]
                                              │
                                              ▼
                                    resolveLlmProvider(useCase)
                                              │
                                              ▼
                                    determineProvider(requested) ──► runtime provider
                                              │
llmModelOverrides[useCase] ──► resolveLlmModel(runtime, useCase, bound) ──► model name
```

## Validation rules

| Rule | Behavior |
|------|----------|
| Empty / whitespace provider override | Unset |
| Invalid provider token | Unset + one init warning |
| Override === global | Valid no-op |
| Empty / whitespace model override | Unset |
| Model override when runtime ≠ bound | Discard; log ≤1×/invocation; use provider default model |
| Model name unsuitable for bound when runtime === bound | Existing client failure (no new validator) |

## State transitions (per invocation)

```text
[config loaded]
    → requested = resolveLlmProvider(useCase)
    → bound = deriveBound(requested, processPreferred)
    → runtime = determineProvider(requested)   // may fallback
    → model = resolveLlmModel(runtime, useCase, bound)
    → call provider API
```

No multi-step durable state machine.
