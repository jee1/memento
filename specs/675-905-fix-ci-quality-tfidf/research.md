# Research: #905 Nightly quality provider / CI red

## R1 — Why Nightly is red (2026-08-23+)

**Decision**: Treat missing `@memento/core` build as the infra root cause.

**Evidence**: Failed runs show `ERR_MODULE_NOT_FOUND` for `@memento/core/dist/index.js`
imported from `scripts/lib/benchmark-search-database.ts` (after #812 moved seed helper
to `scripts/lib` with package import). `test-heavy` builds core; `test-search-quality` does not.
Last green (2026-08-16) predated that import path.

**Alternatives considered**: Blaming MRR regression — rejected; gate never reaches MRR table.

## R2 — Corpus vs DB_PATH

**Decision**: category-report always seeds `tests/fixtures/search-quality/benchmark-v3`
into a temp SQLite. `DB_PATH` env in nightly is unused by this gate.

**Evidence**: `quality-benchmark-category-report.ts` + `createSeededBenchmarkDatabase`.

## R3 — Provider hardcoding

**Decision**: Replace tfidf+mock hardcode with resolved `EMBEDDING_PROVIDER`
(config default `minilm`). Fail closed on provider mismatch / embed failure.

**Alternatives considered**:
- Keep offline tfidf baseline + only add header — fails issue completion criterion #2.
- Dual mode (`BENCHMARK_MODE=offline|prod`) — YAGNI for this issue; single production-aligned path.

## R4 — ONNX / #890

**Decision**: Keep `ONNXRUNTIME_NODE_INSTALL=skip`. CPU runtime remains bundled; minilm
inference does not need CUDA NuGet download.

## R5 — MRR threshold

**Decision**: Keep `0.5`. Recalibration needs measured minilm category MRR after seed change;
do not invent a new number in this PR.
