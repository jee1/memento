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

Full guide (KO): [troubleshooting-node-version.md (KO)](../ko/troubleshooting-node-version.md).
