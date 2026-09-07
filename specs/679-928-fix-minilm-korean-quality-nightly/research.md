# Research: #928 MiniLM Korean quality Nightly wiring

## Decision 1 — Job placement

**Decision**: Add step to existing `test-search-quality` (not `test-heavy`, not new job).

**Rationale**: Job already sets `EMBEDDING_PROVIDER: minilm`, builds `@memento/core`,
and runs MiniLM-backed category-report. Shared HF cache benefits both steps.

**Alternatives considered**:
- New dedicated job — more YAML/npm ci cost; rejected (SC-005 simplify).
- `test-heavy` — unrelated heavy suites; weaker semantic grouping.

## Decision 2 — Cache path

**Decision**: `actions/cache@v5` with `path: ~/.cache/huggingface`, key includes
OS + `MINILM_MODEL_ID` string (or hash of embedding-models.ts / lockfile).

**Rationale**: `@huggingface/transformers` / Xenova default cache home;
~118MB q8 onnx per issue comment.

**Alternatives**: No cache — works but slower cold runs; rejected for SC-003.

## Decision 3 — Skip detection

**Decision**: Rely on `RUN_EMBEDDING_QUALITY=1` (exact) + topology contract; do not
parse vitest “skipped” stdout.

**Rationale**: `describe.skipIf(!ENABLED)` is boolean on `'1'`. Env wrong ⇒ skip;
contract prevents env removal. Fragile log parsers rejected.

## Decision 4 — PR CI

**Decision**: Leave `ci.yml` unchanged.

**Rationale**: Issue explicitly avoids PR model download cost.
