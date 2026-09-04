# Data Model: #810

## memory_forgetting_event (existing)

| Column | Retention use |
|--------|----------------|
| created_at | Expiry predicate `created_at < cutoff` |
| memory_id | Not used in time retention |

No FK. Index `idx_memory_forgetting_event_created_at` supports DELETE.

## memory_embedding (existing)

| Column | Residue use |
|--------|-------------|
| dimensions | `= 0` → cleanup candidate |
| embedding_provider | Report filter `minilm` |
| memory_id | Join to memory_item for gap report |

## Batch job result

```typescript
{ retentionDays: number; deleted: number }
```

## CLI report shape

```typescript
{
  missing_minilm_semantic: { count: number; sample_ids: string[] };
  duplicate_minilm_vectors: { count: number; sample_pairs: Array<{ memory_ids: string[] }> };
  dimensions_zero: { count: number; ids: string[] };
}
```
