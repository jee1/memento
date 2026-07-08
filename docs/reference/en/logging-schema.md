# Logging field schema

Structured logs flow through `packages/memento-core/src/shared/utils/logger.ts`; MCP stdio mode also uses `packages/memento-server/src/server/mcp-logger.ts`. Use one logger entry point so levels and metadata stay consistent across domains.

## Overview

All production paths should call the shared `logger` (`debug` / `info` / `warn` / `error`) with optional `meta` objects. MCP vs HTTP mode is detected automatically.

Field naming, PII rules, and example payloads are documented in Korean.

Full schema (KO): [logging-schema.md (KO)](../ko/logging-schema.md).
