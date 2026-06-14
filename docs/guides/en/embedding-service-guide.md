# Embedding Service Guide

## Why Embeddings Matter

Memento searches stored memories by semantic similarity, not by keyword matching. This means a memory about "useEffect cleanup functions" can surface when you search for "React component lifecycle" — because the concepts are close in meaning even though the words differ. Embeddings make this possible by transforming text into high-dimensional numeric vectors, where semantically similar texts end up near each other in vector space.

Memento abstracts this through a single `UnifiedEmbeddingService` interface. You select a provider with one environment variable, and if that provider fails, the system automatically falls back to an alternative.

## Provider Comparison

Memento supports four embedding providers.

**tfidf / lightweight**: TF-IDF statistical embeddings. Extremely fast (around 0.82ms average), low memory footprint (~4.48MB), and completely free. Generates 512-dimensional vectors. Suitable for high-volume text processing or resource-constrained environments. Relies on term frequency rather than semantic understanding, so search accuracy is lower than neural alternatives.

**minilm**: A lightweight neural network model running locally. Processes text in about 56ms on average, genuinely understands meaning, and is completely free. Generates 384-dimensional vectors. This is the default provider and offers the best balance of performance and cost for most AI agent workflows.

**openai**: Uses OpenAI's cloud API (e.g., `text-embedding-3-small`). Provides the highest semantic understanding quality and generates 1536-dimensional vectors. Requires `OPENAI_API_KEY` and incurs API costs. Best suited for environments where search accuracy is critical.

**gemini**: Uses Google's cloud API (e.g., `text-embedding-004`). Generates 768-dimensional vectors with strong multilingual capabilities. Requires `GEMINI_API_KEY` and incurs API costs.

## Selecting a Provider

Set the `EMBEDDING_PROVIDER` environment variable to choose your provider:

```bash
# .env file
EMBEDDING_PROVIDER=minilm   # default
# EMBEDDING_PROVIDER=tfidf
# EMBEDDING_PROVIDER=openai
# EMBEDDING_PROVIDER=gemini
```

The priority order is as follows. The value set in `EMBEDDING_PROVIDER` is used first. If no value is set, `minilm` is the default. If the specified provider fails to initialize (missing API key, network error, etc.), the system automatically falls back to the next available provider, ultimately landing on a free local provider.

## Environment Variable Summary

```bash
# Provider selection
EMBEDDING_PROVIDER=minilm        # tfidf | lightweight | minilm | openai | gemini

# OpenAI embedding settings (required when EMBEDDING_PROVIDER=openai)
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=text-embedding-3-small   # embedding model (separate from LLM model)

# Gemini embedding settings (required when EMBEDDING_PROVIDER=gemini)
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=text-embedding-004       # embedding model (separate from LLM model)

# Dimension override (usually unnecessary)
EMBEDDING_DIMENSIONS=384              # defaults to provider's native dimension if unset
```

Note that `OPENAI_MODEL` and `GEMINI_MODEL` are for embeddings only. The models used for LLM inference (relation extraction, consolidation, etc.) are configured separately via `OPENAI_LLM_MODEL` and `GEMINI_LLM_MODEL`.

## Fallback Behavior

When the configured provider cannot be initialized, Memento logs a warning and switches to the next available option. For example, if `EMBEDDING_PROVIDER=openai` is set but `OPENAI_API_KEY` is missing or the API call fails, the system falls back to minilm or tfidf. This ensures that Memento continues to function even during API outages or key expiration.

## Dimension Consistency

Embedding dimensions must remain consistent throughout a database's lifetime. If you switch from minilm (384 dimensions) to openai (1536 dimensions), previously stored vectors and newly generated vectors will have different dimensions, making vector similarity search meaningless.

When changing providers, either start with a fresh database or regenerate the embeddings for all existing memory items. Simply updating the environment variable without handling existing data will degrade search quality.

`EMBEDDING_DIMENSIONS` should not need to be set manually in most cases. Each provider uses its native dimension by default.

## Troubleshooting

**MiniLM is slow on first use.** The model loads into memory on the first call. Subsequent calls use the cached model and are fast.

**OpenAI or Gemini API errors.** Verify your API key is set correctly and that you have sufficient quota. HTTP 429 indicates quota exceeded; 401 indicates an invalid key. Automatic fallback will activate when errors occur.

**Vector dimension mismatch errors.** This happens when you switch providers without clearing existing data. Reset your database or set `EMBEDDING_DIMENSIONS` to match the current provider's native dimension.

## Related Documentation

- [Embedding Configuration Reference](./embedding-configuration.md)
- [LLM Provider Configuration Guide](./llm-provider-configuration.md)
