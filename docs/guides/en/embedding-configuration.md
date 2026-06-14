# Embedding Configuration

## Overview

Memento's embedding configuration is controlled entirely through environment variables. The same variables apply regardless of how you run the server — stdio MCP, HTTP server, or CLI. You can place them in a `.env` file at the project root or export them in your shell environment.

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

When changing providers, choose one of these approaches:

- Start fresh by clearing your database and reindexing.
- Regenerate all existing memory embeddings using the new provider.

Do not simply update the environment variable and leave existing data as-is.

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
