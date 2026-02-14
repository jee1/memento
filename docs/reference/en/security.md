# Security Notes

## HTTP API authentication and authorization

- **Current state**: The HTTP server (`/tools/*`, `/api/*`, `/admin/*`, `/quality/*`, etc.) has **no authentication or authorization middleware.** It only checks `req.toolContext`. If exposed on a network, anyone can call memory read/delete/admin APIs.
- **Recommended use**: Use **only on internal networks** or **with MCP clients only**. Do not expose the HTTP server on public networks.
- **Production**: If exposing publicly, introduce **authentication middleware** (e.g. API keys, JWT) and apply **role-based access control** to admin/delete endpoints.
- **CORS**: You can restrict allowed origins with the `CORS_ALLOWED_ORIGINS` environment variable. If empty, cross-origin requests are not allowed.
