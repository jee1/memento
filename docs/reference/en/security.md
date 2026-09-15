# Security Notes

The HTTP admin server uses **several trust surfaces at once**: cookie sessions for browser dashboards, scoped API tokens for programmatic MCP and quality endpoints, and a legacy single-key fallback when `MEMENTO_API_TOKENS` is unset. Before exposing Memento beyond loopback, decide which routes must be reachable and configure tokens and bind addresses accordingly.

## Production dependency audit (#756 / #909 / #942)

- **CI gate**: `.github/workflows/security-check.yml` runs two lanes. (1) Production — `node scripts/check-production-audit-fixable.mjs` (`npm audit --omit=dev`), **fails if any fixable High/Moderate/Critical** remains. (2) Full tree (#909) — the same script with `--include-dev`, failing only on **High/Critical fixable within wanted ranges** (findings that need a semver-major bump are excluded). A following `npm audit summary` step records the complete result in the job summary.
- **Policy**: resolve only within wanted (minor/patch) ranges. Do not use `npm audit fix --force` or `overrides` to yank the ML stack (`AGENTS.md` wanted-only deps).
- **Accepted allowlist (#942)**: the gate’s source of truth is `security/accepted-audit.json`. Upstream-blocked (unfixable) findings missing from that list fail Security Check. `scripts/lib/accepted-audit-allowlist.spec.ts` enforces set equality between the allowlist and the Upstream-blocked table below, so new acceptances must update **the table and the JSON in the same PR**. A High that is major-only in the full-tree lane also requires an allowlist entry — it does not auto-pass.
- **Upstream-blocked (accepted risk, no force-override)** — remeasured 2026-09-09:

| Package path | Advisory / notes | Why blocked | Tracking |
|--------------|------------------|-------------|----------|
| `adm-zip` ← `onnxruntime-node` ← `@huggingface/transformers` | [GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85) (High) — crafted ZIP → large allocation | Upstream `onnxruntime-node` pins vulnerable `adm-zip`; no non-force fix in our lockfile | Re-check on `@huggingface/transformers` / `onnxruntime-node` upgrades; issue #756 |
| `sharp` ← `@huggingface/transformers` | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) (High) — libvips CVEs; needs `sharp>=0.35` | Parent still depends on `sharp<0.35`; force override risks native/ABI breakage | Same; prefer upstream bump over override |

- **High-severity ledger, 8 findings (#909)** — measured 2026-09-09 (`npm audit`: 8 high / 3 moderate; `--omit=dev`: 4 high):

| Package (path) | Advisory | Action or acceptance rationale | Re-review trigger |
|----------------|----------|--------------------------------|-------------------|
| `@huggingface/transformers` (direct, prod) | Aggregate node — via `onnxruntime-node` and `sharp` | **Accepted.** No advisory of its own; clears once the two transitives below clear | On `@huggingface/transformers` upgrade |
| `adm-zip` ← `onnxruntime-node` ← `@huggingface/transformers` (prod) | [GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85) (High), [GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9) (Moderate) | **Accepted.** Upstream `onnxruntime-node` pins the vulnerable `adm-zip`; `fixAvailable=false`. No force override | On `onnxruntime-node` / `@huggingface/transformers` upgrade |
| `onnxruntime-node` ← `@huggingface/transformers` (prod) | Via `adm-zip` (no advisory of its own) | **Accepted.** Same root cause as the row above | Same |
| `sharp` (direct + ← `@huggingface/transformers`, prod) | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) (libvips, needs `sharp>=0.35`), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) (libheif, needs `sharp>=0.35.4`) | **Accepted.** Parent still depends on `sharp<0.35`; a force override risks native/ABI breakage | Prefer an upstream bump over an override |
| `brace-expansion` (dev — eslint / minimatch / glob / rimraf / test-exclude, 6 nodes) | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) (all High, ReDoS / OOM DoS) | **Fixed (verified)** — lockfile-only bump: `1.1.15→1.1.18`, `2.1.1→2.1.4`, `5.0.6→5.0.9` | New advisories; the dev lane now watches it |
| `js-yaml@4.3.0` (dev — `eslint@8.57.1` → `@eslint/eslintrc@2.1.4`) | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) (High, quadratic CPU in `!!omap`), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) (High, `maxTotalMergeKeys` bypass) | **Fixed (verified)** — lockfile bump `4.3.0→4.3.2` | eslint 8 is EOL; the eslint 10 major is a separate issue |
| `nanoid@3.3.15` (dev — `vitest` → `vite` → `postcss`) | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (High, infinite-loop DoS) | **Fixed (verified)** — lockfile bump `3.3.15→3.3.18` | Re-verify together with the `postcss` bump |
| `postcss@8.5.15` (dev — `vitest@3.2.7` → `vite@7.3.6`) | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) (High, sourceMappingURL path traversal), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (Moderate, incomplete fix) | **Fixed (verified)** — lockfile bump `8.5.15→8.5.28` | Re-verify on vite/vitest upgrades |

- **3 moderate (dev)**: `vitest`, `@vitest/mocker`, `@vitest/coverage-v8` — [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (path traversal via mocker redirect). **Accepted**: the fix requires the `vitest@5` **major**, and majors are tracked as separate issues under the wanted-only policy (`AGENTS.md`). This is why the dev lane gates High/Critical only.
- **CI**: the `Full npm audit (dev included)` step (`--include-dev`) blocks High/Critical findings fixable within wanted ranges, and the `npm audit summary` step writes the full list to the job summary, so dev findings cannot pile up unseen again.
- **Exploitability**: these transitives load on the MiniLM / local embedding path. Exposure is limited when ZIP/image inputs are untrusted. New fixable High/Moderate still fail CI.

## HTTP API authentication and authorization

- **Current state**: The HTTP server uses a **split trust model**. `/auth/session` starts the cookie-backed browser-session flow. `/admin/*` and `/api/*` require that browser session. Programmatic routes use scoped tokens as follows:
  - `/tools/*`, `/mcp`, `/messages`, `/api/v1/agent` — **`tools:invoke` scope** token (`Authorization: Bearer` or `X-API-Key`)
  - `/api/v1/quality/*`, `/api/v1/maintenance/*`, `/api/v1/audit/*` — **`admin:destructive` scope** token (programmatic admin APIs)
- **Scoped tokens (`MEMENTO_API_TOKENS`)**: Configure multiple keys as a JSON array. Example:
  ```json
  [
    { "id": "agent-tools", "secret": "<hex>", "scopes": ["tools:invoke"] },
    { "id": "ops-admin", "secret": "<hex>", "scopes": ["admin:destructive", "tools:invoke"] }
  ]
  ```
  A token with only `tools:invoke` gets **403 Forbidden** on quality APIs.
- **Legacy `ADMIN_API_KEY`**: Used only when `MEMENTO_API_TOKENS` is unset, as a synthetic `legacy-admin` token with both scopes. A one-time deprecation warning is logged at startup. New deployments should migrate to `MEMENTO_API_TOKENS`.
- **Recommended use**: Unless you have a clear reason not to, keep the HTTP server on **loopback or an internal network**. Open the browser dashboard/graph same-origin with the server so the session cookie is not shared across origins.
- **Production**: Use scoped tokens for programmatic access, and keep `MEMENTO_HTTP_BIND_HOST` on loopback unless you intentionally expose the server.
- **Browser secret handling**: The server does **not** deliver API secrets to browser assets. Operators sign in through `/auth/session`, which exchanges the typed key for an HTTP-only session cookie. `/dashboard` is the recommended entry point, and opening `/graph` directly now offers the same session-backed sign-in/re-auth path. The graph UI requires a browser session before the graph surface unlocks. Neither page bootstraps the key into JavaScript.
- **CORS**: Restrict allowed origins with `CORS_ALLOWED_ORIGINS`. If empty, cross-origin requests are not allowed.

## Multi-agent owner scope (HTTP)

- **`/tools/recall` and `/tools/memory_injection`**: Default `MEMENTO_OWNER_SCOPE_MODE=strict` — when `owner_id` is omitted, filter with `X-Memento-Agent-Id` or `MEMENTO_HTTP_DEFAULT_AGENT_ID`. Missing identity → **400**.
- **Legacy opt-out**: To allow global HTTP recall of `owner_id = NULL` rows, relax with `MEMENTO_OWNER_SCOPE_MODE=warn` (warn only) or `off` (no enforcement). Details: [`docs/guides/en/multi-agent-usage.md`](../../guides/en/multi-agent-usage.md).

## HTTP programmatic audit log (JSONL + hash chain)

- **Scope**: Programmatic calls on `/tools/*`, `/api/v1/agent/*`, `/api/v1/quality/*`, `/api/v1/maintenance/*`, `/api/v1/audit/*`, and protected MCP HTTP paths (`/mcp`, `/messages`) are written to JSONL and a SQLite hash chain. MCP stdio tool dispatch is also written to the SQLite chain.
- **Default path**: If `MEMENTO_HTTP_AUDIT_LOG_PATH` is unset, `http-audit.jsonl` next to the DB file (`{dirname(DB_PATH)}/http-audit.jsonl`).
- **JSONL field contract**: `{ ts, key_id, route, tool, owner_id, agent_id, latency_ms, status }`. SQLite `audit_log` adds `transport`, `action`, `target_uri`, evidence/coverage state, `previous_hash`, and `current_hash`. Raw credentials, arguments, outputs, and memory content are not recorded.
- **key_id**: Prefers `req.programmaticAuth.keyId` (future API-key table, #662); otherwise a 12-character SHA-256 prefix of the Bearer/X-API-Key credential; nonstandard `Authorization` → `legacy-key`; browser session cookie → `session`; else `anonymous`.
- **Policy**: JSONL stays `MEMENTO_HTTP_AUDIT_MODE=best-effort`. The SQLite chain defaults to `MEMENTO_AUDIT_MODE=best-effort`; in `strict`, `delete`/`admin` without actor/table coverage is rejected before execution. `auth_denied` already means 401/403; an incomplete record may still be written when possible.
- **owner_id / agent_id**: Best-effort from request body `owner_id`/`agent_id`, headers `X-Memento-Agent-Id`/`X-Agent-Id`, and ToolContext (`agentId`).
- **Query and retention**: `/api/v1/audit/entries` and `/api/v1/audit/export` require `admin:destructive` scope. The append-only chain has no automatic purge — use DB backups and verified export archives. See [Hash-Chained Audit Log](./audit-log.md) for evidence and retention policy.

## HTTP rate limit

- **Buckets**: `/tools/*` and `/admin/*` have **separate** limits (`express-rate-limit`, fixed 15-minute window).
- **Defaults**: tools 100 / 15 min, admin 30 / 15 min.
- **Environment**: `MEMENTO_HTTP_RATE_LIMIT_TOOLS`, `MEMENTO_HTTP_RATE_LIMIT_ADMIN` (integer max requests per window). Disabled when `MEMENTO_HTTP_RATE_LIMIT_DISABLED=1` or `NODE_ENV=test`.
- **429**: On exceed, returns `429 Too Many Requests` with a `Retry-After` header (seconds).

## File-based secrets

In production, prefer **not** putting API keys and tokens as plaintext environment variables.

- **`.env`**: Local development only. Do not commit it. Confirm `.env` is in `.gitignore`.
- **File mounts**: In Docker/systemd, read files such as `secrets/openai_api_key` and inject via start scripts, e.g. `export OPENAI_API_KEY="$(cat /run/secrets/openai_api_key)"`.
- **Permissions**: Secret files should be `chmod 600`, owned by the service account only. Review scripts so values never print to logs or stderr.
- **`MEMENTO_API_TOKENS`**: You can keep the full JSON array in a file and have a wrapper set `MEMENTO_API_TOKENS` from it (e.g. `MEMENTO_API_TOKENS_FILE=/run/secrets/memento_api_tokens.json` as a deploy convention — the official env key remains `MEMENTO_API_TOKENS`).

## Docker secrets

Use Docker Swarm or Compose secrets so sensitive values are not baked into images or compose YAML.

- **Example**: `docker/docker-compose.prod.secrets.example.yml` — `secrets:` with `file:`-based external secrets (no plaintext API keys).
- **In-container path**: Mounted at `/run/secrets/<name>`. `start-container.sh` or the entrypoint reads those files into `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MEMENTO_API_TOKENS`, etc.
- **Separate from volumes**: Do not confuse the DB data volume (`~/.memento/data`) with secret mounts. Backups and replicas must not include secret files.

## Leak prevention checklist

| Item | Check |
|------|-------|
| No `.env`, `*.pem`, or `*api*key*` in git | `git status`, `.gitignore` |
| HTTP audit JSONL stores hashed `key_id`, not full Bearer tokens | Sample `http-audit.jsonl` |
| `TELEMETRY_STORE_QUERY_PLAINTEXT` defaults to false (no full recall query text) | env |
| No API secret exposed to the browser dashboard | `/dashboard` network tab |
| Scoped tokens required when intentionally exposing via `MEMENTO_HTTP_BIND_HOST` | Deploy checklist |
| `ADMIN_API_KEY` masked in CI logs | workflow `secrets.*` |
| DB backups/exports exclude secret paths | `npm run db:backup` artifacts |

## SQLCipher / volume encryption (optional, unofficial)

Memento does **not** ship SQLCipher or disk encryption. The notes below are for operators applying encryption at the infrastructure layer.

- **SQLCipher**: Replacing `better-sqlite3` with a SQLCipher build is an **unsupported** custom path. You must validate migrations, native rebuilds, and compatibility yourself.
- **Volume encryption**: Encrypt the volume that holds `DB_PATH` with LUKS, cloud disk encryption, or encrypted NFS.
- **Backups**: Document key management (KMS, offline keys) together with retention of `db:backup` artifacts.
