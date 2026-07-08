# Memento CLI for AI

Agents can drive Memento through **CLI subcommands** as well as MCP tools. From another project directory, the safest invocation is `npm exec --package memento-mcp-server -- memento ...`; after a global install, use `memento` directly.

## Workflow

Before work: `recall` or `memory_injection` to load context. During work: save with the right `type`. After work: `episodic` for completed tasks, `semantic` for reusable facts, `procedural` for repeatable procedures.

Full command reference (Korean): [memento-cli-for-ai.md (KO)](../ko/memento-cli-for-ai.md).

## Database path

Set `DB_PATH` or `--db-path`. Default file is `~/.memento/memory.db`. `.env` is resolved from `--env-file`, `MEMENTO_CONFIG_DIR`, cwd, then `~/.memento/.env`.

## Examples

```bash
# Recall from another repo
npm exec --package memento-mcp-server -- memento recall "JWT expiry handling" --type episodic --limit 5

# Remember after a task
npm exec --package memento-mcp-server -- memento remember \
  "Fixed port docs to 9001" --type episodic --tags documentation,completed
```
