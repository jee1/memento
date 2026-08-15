---
name: memento-memory-loop
description: Use at the start of any non-trivial task to load prior context from Memento, and at the end to persist what was decided or learned. Also use when the user says "what did we decide", "remember this", "기억해", "지난번에", or asks about past sessions.
---

# Memento memory loop

Memento is an MCP memory server. Memory only compounds if you both **read** it before working and **write** it after.

## Before the work

Call `recall` with a natural-language sentence — not keywords. The ranking is hybrid (FTS5 + vector), so a sentence retrieves better than a bag of words.

```
recall(query: "How did we handle JWT expiry in this repo last time?", type: "episodic")
```

- Always pass `type` (`working` | `episodic` | `semantic` | `procedural`). It is required by default (`MEMENTO_TYPE_PARAM_MODE=error`).
- Prefer `memory_injection` when you want a token-budgeted summary rather than raw hits.
- Scope with `project_id` or `owner_id` when several projects or agents share one database.

If a recalled memory actually changed what you did, say so with `feedback`:

```
feedback(memory_id: "mem_...", helpful: true)
```

That signal feeds ranking. Skipping it is how a memory store rots.

## After the work

Write the outcome back. Pick the type by what the information *is*, not by when it happened:

| Type | Use for | Lifetime |
|------|---------|----------|
| `working` | in-flight state for the current session | 48h |
| `episodic` | what happened: decisions, incidents, completed work | 90d (pinned: forever) |
| `semantic` | durable knowledge: how a thing works, why a rule exists | forever |
| `procedural` | repeatable steps: deploy, release, review checklist | forever, versioned |

```
remember(
  content: "Release 1.29.0 shipped; registry publish runs after the GitHub Release step.",
  type: "episodic",
  tags: ["release", "ci"],
  importance: 0.8
)
```

Write a memory whenever a turn produced real work — a code change, a decision, a configuration, a fix. Search first (`recall`) so you update instead of duplicating.

## Procedures evolve

Store repeated processes with `remember_procedure`. When a step changes, save the new version and use `procedural_diff` / `procedural_rollback` to see or undo the change — that history is the point.

## Anchors

`set_anchor` pins the context a long task keeps needing; `get_anchor` restores it in a fresh session. Use it for the one or two facts you would otherwise re-explain every time.

## Housekeeping

If `recall` responses carry an `introspection_hint`, low-confidence or high-failure memories have accumulated. Report it to the user and point them at `get_introspection_summary` — do not silently keep injecting bad context.
