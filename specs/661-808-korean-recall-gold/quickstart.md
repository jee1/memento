# Quickstart: 661-808-korean-recall-gold

## CI / schema (no LoCoMo)

```bash
npx tsx scripts/korean-gold-validate.ts --fixture tests/fixtures/agent-memory-benchmark-ko
npx vitest run scripts/korean-gold-validate.spec.ts
```

## Korean arm (measure-only)

```bash
npm run build -w @memento/core
npx tsx scripts/agent-memory-benchmark.ts \
  --fixture tests/fixtures/agent-memory-benchmark-ko \
  --arm korean \
  --production \
  --output .local/korean-gold/results.json \
  --scorecard-out .local/korean-gold/scorecard.json
```

Or via npm script:

```bash
npm run quality:agent-memory:production -- \
  --fixture tests/fixtures/agent-memory-benchmark-ko \
  --arm korean \
  --output .local/korean-gold/results.json \
  --scorecard-out .local/korean-gold/scorecard.json
```

`--arm korean` is required for the ko fixture (FR-019). Report and scorecard set `arm: "korean"` and `measure_only: true` — no numeric Korean quality gate (FR-024). Keep **`--output`** for `reproduction.git_sha`.

## LoCoMo post-#785 remasure (local)

```bash
npm run quality -- locomo acquire
npm run build -w @memento/core
npx tsx scripts/agent-memory-benchmark.ts \
  --locomo .local/locomo/locomo10.json \
  --production \
  --output .local/locomo/latest/results.json
```

Copy **aggregates only** into `specs/661-808-korean-recall-gold/remasure-locomo.md` (R@10, MRR, git_sha, ranking_version, provider, dataset revision). Do not commit `.local/locomo/`.

## #804 / #807 before-after

1. Run Korean arm at condition A → save report path + SHA.
2. Run condition B (quarantine after / #807 off-ablation or prior SHA).
3. Fill `before-after-804-807.md` with paired metrics. Incomplete pair ≠ US4 done.

## Redaction (live sampling authoring)

Follow `redaction-checklist.md` before any synthetic rewrite commit. Never commit live IDs/bodies.
