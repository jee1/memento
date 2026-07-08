# Embedding provider issues

Memento can run several embedding backends (local MiniLM, OpenAI, Gemini, and others). Each provider differs in latency, dimension, rate limits, and failure modes—so production setups often hit provider-specific quirks before search quality tuning.

This English page is a pointer. The maintained checklist—known bugs, workarounds, env vars, and migration notes—is in the [Korean version](../ko/embedding-provider-issues.md). Read that document when switching providers, debugging dimension mismatches, or interpreting admin embedding health screens.
