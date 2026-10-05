# MCP `type` parameter guide

`remember` and `recall` require **`type`**. Calls that omit it are rejected. Callers must state which memory layer they target so search and forgetting policies stay predictable.

## History

- v1.18: `MEMENTO_TYPE_PARAM_MODE` defaulted to `error`; `warn` / `deprecate` let legacy clients fall back to `episodic` while migrating (#636).
- v2.0.0: `MEMENTO_TYPE_PARAM_MODE` and the `warn` / `deprecate` modes are removed (#1242). The variable is ignored if still set.

## Recommended migration

Add an explicit search type to every `recall` call. Use a single `type` when you need one layer, or `memory_types` **alone** when you need several. If you pass both, `type` wins and `memory_types` is ignored.

## Related docs

- [Core Deprecated API Inventory](../../architecture/core-deprecated-inventory.md) — `type` parameter rollout history
