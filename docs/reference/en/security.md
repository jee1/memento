# Security Notes

The HTTP admin server uses **several trust surfaces at once**: cookie sessions for browser dashboards, scoped API tokens for programmatic MCP and quality endpoints, and a legacy single-key fallback when `MEMENTO_API_TOKENS` is unset. Before exposing Memento beyond loopback, decide which routes must be reachable and configure tokens and bind addresses accordingly.

## HTTP API authentication and authorization

- **Current state**: The HTTP server uses a **split trust model**. `/auth/session` starts the cookie-backed browser-session flow. `/admin/*` and `/api/*` require that browser session. `/api/v1/quality/*`, `/tools/*`, `/mcp`, and `/messages` require `Authorization: Bearer <ADMIN_API_KEY>` or `X-API-Key: <ADMIN_API_KEY>`.
- **Recommended use**: Keep the HTTP server on **loopback or an internal network** unless you have a clear reason to expose it. The browser dashboard/graph should stay same-origin with the server so the session cookie is not shared across origins.
- **Production**: Set `ADMIN_API_KEY`, keep `MEMENTO_HTTP_BIND_HOST` on loopback unless you intentionally expose the server, and treat `/api/v1/quality`, `/tools/*`, `/mcp`, and `/messages` as programmatic surfaces protected by the key. `/admin/*` and `/api/*` remain browser-session-only.
- **Browser secret handling**: The server does **not** deliver `ADMIN_API_KEY` to browser assets. Operators sign in through `/auth/session`, which exchanges the typed key for an HTTP-only session cookie. `/dashboard` is the recommended entry point, and opening `/graph` directly now offers the same session-backed sign-in/re-auth path. The graph surface requires a browser session before the graph surface unlocks. Neither page bootstraps the key into JavaScript.
- **CORS**: You can restrict allowed origins with the `CORS_ALLOWED_ORIGINS` environment variable. If empty, cross-origin requests are not allowed.
