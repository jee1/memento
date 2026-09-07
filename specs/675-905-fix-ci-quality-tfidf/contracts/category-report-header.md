# Contract: category-report stdout header

Before the MRR table line (`macro_category | queries | ...`), stdout MUST include a
metadata line matching:

```text
embedding_provider=<name> vector_dims=<positive_int>
```

- `<name>`: resolved seed/search provider (e.g. `minilm`, `tfidf`)
- `<positive_int>`: embedding vector length stored for that provider

Optional additional keys allowed after the two required keys. Table format unchanged.
