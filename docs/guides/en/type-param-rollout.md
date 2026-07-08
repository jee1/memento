# MCP `type` parameter rollout guide

From v1.18 onward, Memento **rejects** `remember` and `recall` calls that omit **`type`**. Callers must state which memory layer they target so search and forgetting policies stay predictable. While migrating legacy clients, you can relax enforcement with an environment variable.

## Environment variable `MEMENTO_TYPE_PARAM_MODE`

`MEMENTO_TYPE_PARAM_MODE` controls how the server handles a missing `type`.

- **`error`** (default, v1.18+): calls without `type` are rejected. Use this for new deployments.
- **`warn`**: falls back to `episodic` and may log a warning—useful while auditing old clients.
- **`deprecate`**: same as `warn`, with migration guidance in the warning text.

In production, teams often move `warn` → `deprecate` → `error` as clients are updated.

## Recommended migration

Add an explicit search type to every `recall` call. Use a single `type` when you need one layer, or `memory_types` when you need several. Supplying `memory_types` alone can suppress some warnings, but **`type` plus `memory_types`** makes intent clearest.

## Related docs

- [Core Deprecated API Inventory](../../architecture/core-deprecated-inventory.md) — `type` parameter rollout history
