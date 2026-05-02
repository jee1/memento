#!/usr/bin/env node
// Thin runner that starts the HTTP server process.
// Usage: node http-server-runner.js
// Env vars: MCP_SERVER_PORT, DB_PATH, ADMIN_API_KEY, MEMENTO_ALLOW_INSECURE_HTTP_ADMIN
import { startServer } from '../../../memento-server/dist/server/http-server.js';

await startServer();
