# Logging field schema

This document describes the logging field schema of the standard logger module in the Memento monorepo. The standard logger lives at `packages/memento-core/src/shared/utils/logger.ts`; the MCP logger lives at `packages/memento-server/src/server/mcp-logger.ts`.

## Overview

Memento uses a centralized logging system for consistent logs. All logging goes through the standard `logger`; MCP mode and normal mode are detected automatically and the appropriate logging behavior is used.

## Logger interface

The standard logger provides:

```typescript
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

For full field descriptions and conventions, see the [Korean version](../ko/logging-schema.md).
