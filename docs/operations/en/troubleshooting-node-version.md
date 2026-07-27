# Node version troubleshooting

Memento requires **Node.js ≥24** and npm ≥10. Symptoms like missing `better-sqlite3`, failed `npm install`, or cryptic native build errors usually mean the runtime is too old or modules were compiled for another major.

**Quick fix:** install Node 24, run `npm install`, then `npm rebuild better-sqlite3 sqlite-vec` from the repo root (or `npm run rebuild-native`).

## Local verification (repo `.nvmrc`)

The repo root `.nvmrc` pins major `24`. With nvm:

```bash
nvm use                 # reads .nvmrc → 24
nvm alias default 24    # optional
node -v                 # expect v24.x
which node              # confirm nvm path, not a bundled runtime
npm run rebuild-native
```

**Caveat:** Cursor agent (and similar IDE) PATH entries can shadow nvm. Do not trust a single `which node` from an agent shell alone. After any Node major switch, rebuild natives.

## Node 24 switch verification checklist

After a clean install, Docker rebuild, or Node major switch:

1. `npm ci` (or `npm install`)
2. `npm run rebuild-native`
3. Smoke: `node -e "require('better-sqlite3'); require('sqlite-vec'); require('sharp'); require('onnxruntime-node'); console.log('ok')"`
4. `npm run type-check` (and `npm test` when feasible)

Ensure the `node -v` used for rebuild matches the shell that runs tests (Cursor agent PATH can shadow nvm).

Full guide (KO): [troubleshooting-node-version.md (KO)](../ko/troubleshooting-node-version.md).
