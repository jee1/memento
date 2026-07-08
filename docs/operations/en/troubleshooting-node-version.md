# Node version troubleshooting

Memento requires **Node.js ≥24** and npm ≥10. Symptoms like missing `better-sqlite3`, failed `npm install`, or cryptic native build errors usually mean the runtime is too old or modules were compiled for another major.

**Quick fix:** install Node 24, run `npm install`, then `npm rebuild better-sqlite3 sqlite-vec` from the repo root.

Full guide (KO): [troubleshooting-node-version.md (KO)](../ko/troubleshooting-node-version.md).
