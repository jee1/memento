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

### HTTP maintenance API

The HTTP server can run the same work asynchronously when a local CLI is not available. It requires a token with the `admin:destructive` scope; use the returned `statusUrl` to observe completion.

```bash
curl -sS -X POST http://127.0.0.1:9001/api/v1/maintenance/reindex \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"minilm","batchSize":100}'

curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
  http://127.0.0.1:9001/api/v1/maintenance/reindex/<job-id>
```

Jobs and their status are held in the HTTP server process. A server restart loses job history, but never rolls back embeddings already written to SQLite. Run a `--dry-run` first when changing providers, then review `missingEmbeddingCount`, `dimensionMismatchCount`, and `providerDriftCount` after completion.

Instead of a full reindex, use `/backfill-relation-endpoints` to fill only existing semantic memories that are `memory_relation` endpoints (relation neighbors created via the triple → semantic path) and are still missing an embedding (#710).

```bash
curl -sS -X POST http://127.0.0.1:9001/api/v1/maintenance/backfill-relation-endpoints \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"minilm","limit":200}'

curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" \
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
GEMINI_LLM_MODEL=gemini-2.0-flash
LLM_PROVIDER=gemini
```

## Related Documentation

- [Embedding Service Overview](./embedding-service-guide.md)
- [LLM Provider Configuration Guide](./llm-provider-configuration.md)
