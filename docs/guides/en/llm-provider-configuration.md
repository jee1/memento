# LLM Provider Configuration Guide

## Why Memento Needs an LLM

Memento does more than store and retrieve memories. When a new memory is saved, the system extracts semantic relationships with existing memories. Over time, episodic memories are consolidated into semantic knowledge. Procedural memories are analyzed when versions change. All of this intelligent processing relies on an LLM.

The LLM provider (used for reasoning and text generation) is configured independently from the embedding provider (used to convert text into vectors). You can, for example, use local minilm for embeddings while relying on Ollama for relation extraction and consolidation.

## Basic Configuration

Set the `LLM_PROVIDER` environment variable to choose your LLM provider.

```bash
LLM_PROVIDER=auto   # default
```

Valid values are `openai`, `gemini`, `ollama`, and `auto`. When set to `auto`, Memento automatically selects the first available provider based on a priority order.

## Provider-Specific Settings

### Ollama (local, free)

Ollama is an open-source LLM runtime that runs locally without API costs.

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434   # default
OLLAMA_MODEL=llama3                      # default
```

Before using Ollama, start the daemon with `ollama serve` and download a model with `ollama pull llama3`. Memento verifies the connection at startup by sending a GET request to `OLLAMA_BASE_URL/api/tags`. If the connection check fails, a warning is logged and fallback is triggered.

### OpenAI

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_LLM_MODEL=gpt-4o-mini   # default
```

`OPENAI_LLM_MODEL` is for LLM inference only and is separate from `OPENAI_MODEL`, which controls the embedding model.

### Gemini

```bash
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_LLM_MODEL=gemini-2.0-flash   # default
```

`GEMINI_LLM_MODEL` is for LLM inference only and is separate from `GEMINI_MODEL`, which controls the embedding model.

### auto (automatic selection)

With `LLM_PROVIDER=auto`, Memento selects the first available provider in this priority order:

1. OpenAI — selected if `OPENAI_API_KEY` is present
2. Gemini — selected if OpenAI is unavailable and `GEMINI_API_KEY` is present
3. Ollama — tested for connectivity if neither cloud provider is available

## Environment Variable Priority

When the same variable is set in multiple places, the following priority applies:

1. Runtime environment variable (set via `export LLM_PROVIDER=...`)
2. Value in the `.env` file
3. Code default (`auto`)

## Per-Use-Case Model Overrides

Memento uses LLMs in four distinct contexts: triple extraction, relation extraction, procedural memory processing, and episodic-to-semantic consolidation. You can assign a different model to each context, which allows you to balance cost and quality — for example, using an inexpensive small model for extraction while reserving a more capable model for consolidation.

```bash
# Per-use-case model overrides (all optional)
LLM_MODEL_TRIPLE_EXTRACTION=     # triples extraction
LLM_MODEL_RELATION_EXTRACTION=   # relation extraction between memories
LLM_MODEL_PROCEDURAL=            # procedural memory processing
LLM_MODEL_CONSOLIDATION=         # episodic → semantic consolidation
```

When set, these values take precedence over the provider's default model (`OPENAI_LLM_MODEL`, `GEMINI_LLM_MODEL`, or `OLLAMA_MODEL`). The resolution order for any given LLM call is:

1. The corresponding `LLM_MODEL_*` variable (if set)
2. The provider's default model variable (`OPENAI_LLM_MODEL`, etc.)
3. The code's hardcoded fallback (gpt-4o-mini, gemini-2.0-flash, llama3)

## Fallback Behavior

Memento applies automatic fallback when a provider cannot be initialized:

- `LLM_PROVIDER=openai` with a failing OpenAI initialization: falls back to Gemini if `GEMINI_API_KEY` is available.
- `LLM_PROVIDER=gemini` with a failing Gemini initialization: falls back to OpenAI if `OPENAI_API_KEY` is available.
- `LLM_PROVIDER=ollama` with a failed Ollama connection: tries OpenAI first, then Gemini.

If all providers fail, LLM-dependent features (relation extraction, consolidation, etc.) are disabled and a warning is logged. Core `remember` and `recall` operations continue to function.

## Complete Configuration Examples

### Fully local (no cost)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### Mixed (local embeddings, cloud LLM)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_LLM_MODEL=gpt-4o-mini
```

### Fully cloud with per-use-case tuning

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=text-embedding-3-small
LLM_PROVIDER=openai
OPENAI_LLM_MODEL=gpt-4o-mini
# Use a more capable model only for consolidation
LLM_MODEL_CONSOLIDATION=gpt-4o
```

## Troubleshooting

**All providers unavailable.** Check that API keys are set correctly and that the Ollama server is running. Start Ollama with `ollama serve` and verify `http://localhost:11434/api/tags` is reachable in a browser.

**Ollama connection failure.** Confirm `OLLAMA_BASE_URL` is correct. If running inside a Docker container, you may need to use `http://host.docker.internal:11434` instead of `localhost`.

**Unexpected provider selection.** Runtime environment variables override `.env` file values. Check whether `LLM_PROVIDER` has been exported in your shell session before looking at the `.env` file.

## Related Documentation

- [Embedding Configuration](./embedding-configuration.md)
- [Embedding Service Overview](./embedding-service-guide.md)
