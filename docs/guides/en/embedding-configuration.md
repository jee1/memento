# Embedding Configuration

Recall and `remember` both route text through the same embedding stack. Whether you start Memento via **stdio MCP**, the **HTTP admin server**, or the **CLI**, one set of environment variables controls the active provider—set them in the project-root `.env` or export them in your shell before launch. After you pick a provider below, add API keys and model names as needed; every entry point reads the same configuration.

## Overview

The sections that follow list each `EMBEDDING_PROVIDER` value and its required variables.

## EMBEDDING_PROVIDER

Specifies which embedding provider to use. Valid values are `tfidf`, `lightweight`, `minilm`, `openai`, and `gemini`.

```bash
EMBEDDING_PROVIDER=minilm   # default
```

`tfidf` and `lightweight` are aliases for the same TF-IDF-based provider and can be used interchangeably.

If this variable is not set, `minilm` is used as the default.

## Provider-Specific Settings

### tfidf / lightweight / minilm

No additional configuration is required. These providers run locally without any external API.

```bash
EMBEDDING_PROVIDER=minilm
```

### openai

Requires an OpenAI API key and optionally a model name.

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=text-embedding-3-small   # default: text-embedding-3-small
```

`OPENAI_MODEL` specifies the embedding model only. You can choose between `text-embedding-3-small` (1536 dimensions) and `text-embedding-3-large` (3072 dimensions). `text-embedding-3-small` is recommended for most use cases given its cost-to-performance ratio.

### gemini

Requires a Google AI API key and optionally a model name.

```bash
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=text-embedding-004   # default: text-embedding-004
```

`GEMINI_MODEL` specifies the embedding model only. The Gemini model used for LLM inference is configured separately via `GEMINI_LLM_MODEL`.

## EMBEDDING_DIMENSIONS

Explicitly sets the number of dimensions for embedding vectors. In most cases you do not need to set this; each provider uses its native dimension automatically.

| Provider | Default Dimensions |
|---------|-------------------|
| tfidf / lightweight | 512 |
| minilm | 384 |
| openai (text-embedding-3-small) | 1536 |
| gemini (text-embedding-004) | 768 |

```bash
# Generally not needed — provider defaults apply automatically
EMBEDDING_DIMENSIONS=384
```

Set this only when you need to override the provider's default, such as when using a reduced-dimension OpenAI model variant.

## Fallback Behavior

If the configured provider cannot be initialized (missing API key, network error, etc.), Memento automatically falls back in the following order:

1. The provider set in `EMBEDDING_PROVIDER`
2. minilm (local, free)
3. tfidf (local, free, last resort)

A warning is logged whenever a fallback occurs. This means that even if you configure a paid cloud provider, Memento will continue functioning with a free local provider if the cloud provider becomes unavailable.

## Dimension Consistency Warning

Switching providers changes the dimension of newly generated vectors. Existing vectors stored under a different dimension remain in the database and become incompatible with the new vectors. Vector similarity search will produce incorrect results when the database contains vectors of mixed dimensions.

When changing providers, regenerate derived embeddings after changing the environment variable. Use the same provider value in the command and environment; a fallback response is reported as a failed row rather than silently stored under the requested provider.

```bash
npm run reindex-embeddings -- --provider minilm --dry-run
npm run reindex-embeddings -- --provider minilm --batch-size 100
npm run reindex-embeddings -- --provider minilm --owner-id agent-42
```

The JSON result reports missing embeddings, dimension mismatches, and provider drift. Reindexing writes only native embeddings for the requested provider; FTS remains available when a vector provider is unavailable.

Do not simply update the environment variable and leave existing data as-is.

### Model consistency (#889)

Two embeddings of the same dimension are still incomparable when they come from **different models** — the vector spaces do not line up. `minilm` guards against this automatically.

- Every stored embedding records its model name in `memory_embedding.model`.
- Vector search only compares rows produced by the model this build uses (`LOCAL_EMBEDDING_MODEL.storedName` in `packages/memento-core/src/shared/config/embedding-models.ts`).
- A half-finished reindex therefore never mixes models in one cosine comparison. The not-yet-reindexed memories simply drop out of vector search until they are rebuilt; FTS still finds them.
- Features that read stored vectors directly (memory neighbors, anchors, sleep consolidation, the search backfill) also use only current-model rows, and only the native row that represents the whole memory, never a window row. Until a memory is reindexed these features treat it as having no embedding. The fallback vector search compares native and window rows like the main vector search, restricted to current-model rows (#1731, #1732).

Always reindex after changing the model. Reindexing uses only the provider you name (`--provider`); if that provider fails, the memory counts as failed instead of falling back to another provider (#1729). Watch `modelDriftCount` in the `--dry-run` output; it counts a memory when its native row or any window row comes from an old model, and it reaches 0 when the reindex is complete.

```bash
npm run reindex-embeddings -- --provider minilm --dry-run   # check modelDriftCount
npm run reindex-embeddings -- --provider minilm --batch-size 100
```

### Automatic model migration (#1729)

When the build's local embedding model (`LOCAL_EMBEDDING_MODEL.storedName`) changes, the server rebuilds old-model rows by itself after startup. You do not need to reindex by hand.

- It runs `embedding_reconciliation` (1,000 memories per run) back to back until no memory has a native or window row from an old model. A run stops taking new memories after 4 minutes and leaves the rest to the next run. After 20 consecutive failures, or a run that does not lower the remaining count, it stops and the daily scheduled run picks up what is left.
- Only one process runs it: the one that starts the HTTP server (an always-on HTTP server, or a stdio process that took the HTTP sidecar lock). A stdio-only install without the sidecar catches up through the daily run, 1,000 memories a day.
- It uses only the configured local provider. A failure never falls back to an external embedding API or TF-IDF.
- While old-model memories exceed 1% of active memories, Sleep consolidation skips and leaves `모델 드리프트 N건(M%) 때문에 건너뜀` in the job history warnings.
- While the migration or `embedding_reconciliation` runs, `POST /api/v1/maintenance/reindex` returns 409. The CLI `reindex-embeddings` would recompute the same memories as the server's migration, so use it only with the server stopped. Watch progress with `modelDriftCount` from the admin API.
- To turn it off, pause `embedding_reconciliation` through the admin API (cleared on restart) or set `BATCH_SCHEDULER_ENABLED=false` (turns off every batch job).

Search queries become query vectors and stored text becomes passage vectors. When a model expects a different prefix per role, the prefixes live in `LOCAL_EMBEDDING_MODEL.prefixes`, and the window size is 510 minus the prefix token count (#1729). The current model uses `query: ` for search queries and `passage: ` for stored memories (e5 convention).

The default model is `dragonkue/multilingual-e5-small-ko-v2` (384 dimensions, Korean-tuned multilingual-e5-small, apache-2.0). The model files ship as the npm dependency `@jee1/memento-embedding-e5-small-ko-v2` (about 84MB download, 135MB unpacked), so `npm install` and Docker builds fetch it and the runtime reads it from disk with no Hugging Face download. The provider value stays `minilm` for historical reasons. The previous default (paraphrase-multilingual-MiniLM-L12-v2) is replaced; its rows are migrated automatically (see above).

### Cleaning up provider drift (#907)

A reindex writes embeddings for the requested provider and **leaves rows from other providers untouched**. If this database has ever switched providers, `providerDriftCount` therefore never falls, no matter how many times you reindex.

Turn the cleanup on explicitly with `--prune-foreign-providers`. It is off by default.

```bash
npm run reindex-embeddings -- --provider minilm --prune-foreign-providers --dry-run
npm run reindex-embeddings -- --provider minilm --prune-foreign-providers
```

`prunedForeignEmbeddingCount` reports how many rows were removed. Under `--dry-run` it is an upper bound that assumes every memory reindexes successfully.

Only memories that **stored a new embedding successfully in this run** are eligible. Memories whose reindex failed are left alone, so a memory can never lose its only embedding.

Do not enable this if you deliberately maintain two providers at once — for example running TF-IDF searches through `provider_filter: ['tfidf']` alongside another provider. Deleted embeddings cannot be recovered and must be regenerated. Back up the database first.

```bash
npm run db:backup
```

Over HTTP, `"pruneForeignProviders": true` in the request body does the same thing.

### HTTP maintenance API

The HTTP server can run the same work asynchronously when a local CLI is not available. It requires a token with the `admin:destructive` scope; use the returned `statusUrl` to observe completion. A full reindex request is rejected with 409 while the model migration or `embedding_reconciliation` runs (#1729).

```bash
curl -sS -X POST http://127.0.0.1:9001/api/v1/maintenance/reindex \
  -H "Authorization: Bearer $MEMENTO_OPS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"minilm","batchSize":100}'

curl -sS -H "Authorization: Bearer $MEMENTO_OPS_TOKEN" \
  http://127.0.0.1:9001/api/v1/maintenance/reindex/<job-id>
```

Jobs and their status are held in the HTTP server process. A server restart loses job history, but never rolls back embeddings already written to SQLite. Run a `--dry-run` first when changing providers, then review `missingEmbeddingCount`, `dimensionMismatchCount`, and `providerDriftCount` after completion.

Instead of a full reindex, use `/backfill-relation-endpoints` to fill only existing semantic memories that are `memory_relation` endpoints (relation neighbors created via the triple → semantic path) and are still missing an embedding (#710).

```bash
curl -sS -X POST http://127.0.0.1:9001/api/v1/maintenance/backfill-relation-endpoints \
  -H "Authorization: Bearer $MEMENTO_OPS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"minilm","limit":200}'

curl -sS -H "Authorization: Bearer $MEMENTO_OPS_TOKEN" \
  http://127.0.0.1:9001/api/v1/maintenance/backfill-relation-endpoints/<job-id>
```

## Complete Configuration Examples

### Local-only (no API required, recommended default)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### OpenAI-based (highest quality)

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=text-embedding-3-small
OPENAI_LLM_MODEL=gpt-4o-mini
LLM_PROVIDER=openai
```

### Gemini-based

```bash
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=text-embedding-004
GEMINI_LLM_MODEL=gemini-flash-latest
LLM_PROVIDER=gemini
```

## Related Documentation

- [Embedding Service Overview](./embedding-service-guide.md)
- [LLM Provider Configuration Guide](./llm-provider-configuration.md)
