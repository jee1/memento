# npx troubleshooting

Running `npx memento-mcp-server@latest` uses a **fresh cache each time**, so Node version mismatches and native module errors show up differently than with a local clone. This page summarizes common symptoms and recovery order. For repeated use, prefer a global install or a source checkout.

Full step-by-step fixes (Korean): [npx-troubleshooting.md (KO)](../ko/npx-troubleshooting.md).

## Common issues

### SQLite module errors (Node version)

**Symptoms:** `Cannot find module 'better-sqlite3'` or “compiled against a different Node.js version”.

**Cause:** Native modules were built for a different Node major.

**Fix:** Use Node **24+**, then rebuild in the npx cache or switch to a local install. See the Korean guide for cache paths on Windows vs Linux/macOS.
