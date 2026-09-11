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

- **Current state**: The HTTP server uses a **split trust model**. `/auth/session` starts the cookie-backed browser-session flow. `/admin/*` and `/api/*` require that browser session. `/api/v1/quality/*`, `/api/v1/maintenance/*`, `/tools/*`, `/mcp`, and `/messages` require `Authorization: Bearer <ADMIN_API_KEY>` or `X-API-Key: <ADMIN_API_KEY>`.
- **Recommended use**: Keep the HTTP server on **loopback or an internal network** unless you have a clear reason to expose it. The browser dashboard/graph should stay same-origin with the server so the session cookie is not shared across origins.
- **Production**: Set `ADMIN_API_KEY`, keep `MEMENTO_HTTP_BIND_HOST` on loopback unless you intentionally expose the server, and treat `/api/v1/quality`, `/api/v1/maintenance`, `/tools/*`, `/mcp`, and `/messages` as programmatic surfaces protected by the key. `/admin/*` and `/api/*` remain browser-session-only.
- **Browser secret handling**: The server does **not** deliver `ADMIN_API_KEY` to browser assets. Operators sign in through `/auth/session`, which exchanges the typed key for an HTTP-only session cookie. `/dashboard` is the recommended entry point, and opening `/graph` directly now offers the same session-backed sign-in/re-auth path. The graph surface requires a browser session before the graph surface unlocks. Neither page bootstraps the key into JavaScript.
- **CORS**: You can restrict allowed origins with the `CORS_ALLOWED_ORIGINS` environment variable. If empty, cross-origin requests are not allowed.

## Hash-Chained Audit Log

MCP stdio, MCP HTTP, and HTTP administration boundaries write append-only SQLite audit metadata. The default `MEMENTO_AUDIT_MODE=best-effort` does not block an operation when evidence cannot be written; `strict` rejects sensitive delete and administration work before execution when actor coverage or the audit table is unavailable. Audit records exclude raw credentials, tool arguments, tool output, and memory content. Operators can query or export verified records through `/api/v1/audit/*` with `admin:destructive` scope. See [Hash-Chained Audit Log](./audit-log.md) for evidence, retention, and archival rules.
