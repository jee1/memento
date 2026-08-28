# Contract: Per-job LLM provider overrides (env / config)

**Feature**: `658-llm-provider-use-case-override`  
**Kind**: Operator-facing environment configuration (not MCP / HTTP API)  
**Stability**: Additive; omitting all keys preserves pre-feature behavior

## New environment variables

| Name | Type | Required | Default | Meaning |
|------|------|----------|---------|---------|
| `LLM_PROVIDER_TRIPLE_EXTRACTION` | string | no | unset | Preferred LLM provider for triple extraction |
| `LLM_PROVIDER_RELATION_EXTRACTION` | string | no | unset | Preferred LLM provider for relation extraction |
| `LLM_PROVIDER_PROCEDURAL` | string | no | unset | Preferred LLM provider for procedural extraction |

### Accepted values (after trim + lowercase)

`openai` | `gemini` | `ollama` | `auto`

### Semantics

| Input | Effect |
|-------|--------|
| Unset / omitted | Job uses global `LLM_PROVIDER` selection path |
| Empty or whitespace-only | Same as unset |
| Valid token | Job’s **preferred** provider (prefer-then-fallback; not hard-pin) |
| Invalid / unknown token | Same as unset; one `[CONFIG WARN]` (or equivalent) at process config load |
| Equal to global `LLM_PROVIDER` | Valid no-op |

### Out of contract

- `LLM_PROVIDER_CONSOLIDATION` — **not** introduced (consolidation out of scope)
- Request-body / MCP tool provider selection — unchanged / not added
- Embedding provider (`EMBEDDING_PROVIDER`) — unchanged

## Related existing variables (unchanged names)

| Name | Interaction |
|------|-------------|
| `LLM_PROVIDER` | Global default when job override unset |
| `LLM_MODEL_TRIPLE_EXTRACTION` | Applied only if runtime provider equals **bound** provider |
| `LLM_MODEL_RELATION_EXTRACTION` | Same binding rule |
| `LLM_MODEL_PROCEDURAL` | Same binding rule |

### Model-binding rule (normative)

Given job `U` and runtime provider `R`:

1. Bound provider `B` = concrete job override for `U` if set and valid; else concrete global `LLM_PROVIDER` if concrete; else process init `preferredProvider` if non-null; else no use-case model override.
2. If use-case model override is non-empty and `R === B`, apply override.
3. If override non-empty and `R !== B`, discard override, use `R`’s default model, emit observable log ≤1× per job invocation; do not fail solely for discard.

## MCP / HTTP

No new tools, parameters, or response fields. Existing MCP tool contracts remain identical (FR-009).

## Documentation obligations

Operator guides and `env.example` MUST document the three keys, unset/empty rules, invalid→warn-at-init, prefer-then-fallback, and model-binding / discard observability (FR-006).
