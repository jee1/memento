# Personal knowledge agent — CLI guide

`memento agent ask` runs a **personal knowledge loop** on a local SQLite file: it recalls relevant memories, asks an LLM to answer, extracts candidate facts, and waits for you to approve or reject each candidate before calling `remember`. You do not need MCP or the HTTP dashboard—only `--db-path` and optionally an LLM provider. When a server is already up, the same flow is available as **run** then **persist-approved** HTTP APIs, writing into the **live server DB** via `ToolContext`.

Full walkthrough (Korean): [personal-knowledge-agent-mvp.md (KO)](../ko/personal-knowledge-agent-mvp.md).

## Prerequisites

From the repo root: `npm install` and `npm run build`.

Entry point: `node packages/memento-server/dist/cli.js` (or `memento` if on PATH).

## Quick start

Seed a fact, then ask with mock LLM (no API keys):

```bash
DB=./my-knowledge.db
node packages/memento-server/dist/cli.js --db-path "$DB" remember \
  "This project uses TypeScript strict mode" \
  --type semantic

node packages/memento-server/dist/cli.js --db-path "$DB" agent ask \
  "What coding standards does this project use?" \
  --llm mock
```

Use `--project-id` to scope context. For Ollama/OpenAI/Gemini, set `MEMENTO_PERSONAL_AGENT_LLM_PROVIDER` and provider keys as in the Korean guide.

## HTTP runtime

With `npm run dev:http` on port 9001, use the two-step personal agent endpoints documented in the KO guide (`personal:run`, `personal:persist-approved`). See [api-reference.md](../../api/ko/api-reference.md) and the KO HTTP section.
