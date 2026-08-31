# Contract: Korean gold fixture schema

**Feature**: 661-808-korean-recall-gold  
**Consumers**: `korean-gold-validate`, `loadAgentMemoryFixture` (extended), CI

## queries.json (logical shape)

```json
{
  "id": "kq_001",
  "query": "가중치",
  "relevantIds": ["ko_mem_001"],
  "tags": ["particle_agglutination"],
  "targetSessionIds": ["ko_sess_1"]
}
```

## MUST

1. `id` opaque and unique; ≠ `query` string (FR-026).
2. `relevantIds.length ≥ 1` (FR-028).
3. Every `relevantIds` entry exists in corpus (FR-014 write-time).
4. No live DB id patterns (validator denylist / allowlist `ko_mem_` prefix) (FR-015).
5. Set-level: ≥15 queries; ≥1 `particle_agglutination`; ≥1 `short_multi_concept` (FR-012/021).
6. Unknown tags → fail (FR-021).
7. `manifest.synthetic === true`.

## MUST NOT

- Empty relevantIds “abstention” rows in this tree.
- Commit LoCoMo / live memory bodies.
- Use benchmark-v3 text-as-queryId mapping for this arm.

## Fail behavior

Exit non-zero before any scoring (FR-013). No `degraded` baseline.
