# Implementation Plan: Canonical Memento Resource URIs

## Scope

Implement prerequisite #656 from umbrella issue #655. No database migration, ID replacement, or changes to `memory://` MCP resource routing are included.

## Design

1. Add a shared, pure URI formatter/parser. It emits `memento://{owner}/{kind}/{id}` and maps a null or blank owner to `default`.
2. Add URI fields as additive response data:
   - recall result: `uri`
   - feedback result: `uri`
   - relation results: `uri`, `source_uri`, and `target_uri`
   - exports: `uri`
3. Keep `memento://memory/{id}` valid only as a source-field compatibility alias. New outputs never emit it.
4. Document ownership, procedural-memory mapping, encoding, and legacy migration rules in Korean API reference material.

## Test Strategy

- Unit: formatter/parser valid and invalid forms, including encoding and default ownership.
- Focused behavior: recall mapping, feedback response, relation tools, export formats, source validation.
- Regression: type-check, lint, and the relevant package test suites.

## Risks and Constraints

- `memory_relation` has no owner column. A relation URI is owned by its source memory, so that relationship is stable under the current data model.
- A procedural memory uses `procedure` as its resource kind while retaining the same underlying `mem_*` ID.
- Existing consumers may depend on raw IDs and `memory://`; all URI additions are additive.
