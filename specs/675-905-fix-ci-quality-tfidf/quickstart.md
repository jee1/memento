# Quickstart: verify #905 locally

```bash
npm run build -w @memento/core
EMBEDDING_PROVIDER=minilm npm run quality -- benchmark category-report
```

Expect stdout header with `embedding_provider=minilm` and `vector_dims=384` (or actual
minilm dims), then the MRR table. Exit 0 if all categories MRR≥0.5.

Fast regression (unit tests):

```bash
npm test -- scripts/__tests__/benchmark-search-database.spec.ts scripts/quality-benchmark-category-report.spec.ts
```
