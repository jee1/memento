# Issue #236 — `memento agent ask` CLI Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add in-process `memento agent ask` nested command per `docs/superpowers/specs/2026-05-14-issue-236-agent-ask-cli-design.md`, without breaking HTTP-backed `recall|remember|forget|memory_injection`.

**Architecture:** `cli.ts` detects `agent` + `ask` after global-flag stripping, dynamically imports `cli/agent-ask.ts` which calls `createMementoCore` + `createToolContext`, wires `PersonalKnowledgeAgentService` with mock LLM and tool-context adapters, emits JSON or TTY prompts, maps failures to exit codes 1–4 / 130.

**Tech stack:** TypeScript, Vitest, `@memento/core` (`createMementoCore`, `createToolContext`, `mementoConfig`, personal-agent exports).

---

## File map

| File | Role |
|------|------|
| `packages/memento-core/src/index.ts` | Re-export personal-agent service + adapters + mock LLM for `@memento/core` consumers. |
| `packages/memento-server/src/cli/agent-ask.ts` | Parse `agent ask` tail, run core bootstrap, one-turn + optional persist, JSON/TTY I/O. |
| `packages/memento-server/src/cli/agent-ask.spec.ts` | Unit tests for parser; integration with `:memory:` DB. |
| `packages/memento-server/src/cli.ts` | Detect agent-ask / help branches before unknown-command; dynamic `import('./cli/agent-ask.js')`. |
| `packages/memento-server/src/cli/cli-ac5-ac6.spec.ts` | Extend `--help` expectation to mention `agent ask` (optional substring). |

---

### Task 1: Core re-exports

**Files:** Modify `packages/memento-core/src/index.ts`

- [ ] Export `PersonalKnowledgeAgentService`, `DeterministicMockLlmAdapter`, `ToolContextKnowledgeContextAdapter`, `ToolContextRememberPersistenceAdapter`, and types `PersonalKnowledgeAgentDeps` from `./domains/personal-agent/index.js`.

**Verify:** `npm run type-check -w @memento/core`

---

### Task 2: `agent-ask.ts` — parser + runner

**Files:** Create `packages/memento-server/src/cli/agent-ask.ts`

- [ ] Implement `stripGlobalCliArgs(argv: string[]): string[]` (same three global pairs as `cli.ts`).
- [ ] Implement `parseAgentAskInvocation(argv)` → `{ userMessage, projectId?, tokenBudget?, json, noSave, llmMock }` or `{ kind:'help' }` or `{ kind:'error', message }`.
  - Require token sequence `agent` `ask` then **first tail token is userMessage** (must not start with `-`).
  - Parse remaining with `parseArgvToParams` from `option-map.ts`; support `--llm mock` (reject other values with usage error).
- [ ] `resolveDbPath(pre: { dbPath?: string }): string` = `pre.dbPath?.trim() || process.env.DB_PATH?.trim() || mementoConfig.dbPath`.
- [ ] `runAgentAskMain(preOptions, argv): Promise<number>`: `createMementoCore`, `createToolContext`, construct service, `runOneTurn`, build success payload; if interactive persist, `readline` loop `y|n|s|q`; `persistApprovedCandidates` when needed; always `closeDatabase` + sampler cleanup in `finally`.
- [ ] JSON helpers: `jsonSuccess(obj)`, `jsonFailure(code, stage, message, details?)` one line stdout.
- [ ] Exit codes per spec; `MEMENTO_DEBUG` prints stack on stderr for thrown errors.
- [ ] SIGINT: no persist, stderr message, exit `130` (optional JSON line for `--json` only if clean single write — skip if risky).

**Verify:** `npm run type-check -w memento-server`

---

### Task 3: Wire `cli.ts`

**Files:** Modify `packages/memento-server/src/cli.ts`

- [ ] Add `detectAgentAskForMain(argv, help: boolean)` returning discriminated union.
- [ ] At start of `main()`, after `showHelp` computation: if `agent help` variants, print agent help text (options list) and `return 0`.
- [ ] If `agent ask` run: `return (await import('./cli/agent-ask.js')).runAgentAskMain(preOptions, process.argv)` (adjust export name).
- [ ] General `--help` text: add one line for `agent ask`.
- [ ] Ensure `memento agent foo` hits unknown agent subcommand exit `1` before generic unknown.

**Verify:** manual `node dist/cli.js --help` after build.

---

### Task 4: Vitest

**Files:** Create `packages/memento-server/src/cli/agent-ask.spec.ts`

- [ ] Test parser: valid `agent ask "hi" --json`, invalid `agent ask` (no message), invalid `--llm openai`.
- [ ] Test integration: `createMementoCore({ dbPath: ':memory:' })` path via exported `runAgentAskFromArgv` or internal helper with synthetic `argv` array — **avoid** spawning `dist/cli.js` in this file to keep fast; optional one spawn test in separate slow describe gated by env.

**Run:** `npm test -w memento-server -- --run src/cli/agent-ask.spec.ts`

---

### Task 5: Repo gates

- [ ] `npm test && npm run lint` from monorepo root (per AGENTS.md).

---

### Task 6: Commit

```bash
git add packages/memento-core/src/index.ts packages/memento-server/src/cli.ts packages/memento-server/src/cli/agent-ask.ts packages/memento-server/src/cli/agent-ask.spec.ts docs/superpowers/plans/2026-05-14-issue-236-agent-ask-cli.md
git commit -m "feat(cli): agent ask in-process 명령 (#236)"
```

---

## Spec coverage (self-review)

| Spec section | Task |
|--------------|------|
| In-process / no HTTP | Task 2 |
| Nested `agent ask` | Task 2–3 |
| Options + `--llm mock` | Task 2 |
| TTY y/n/s/q | Task 2 |
| `--json` / `--no-save` / non-TTY | Task 2 |
| JSON schema + exit codes | Task 2 |
| Core bootstrap | Task 2 (reuse `createMementoCore` + `createToolContext`; no new core helper unless file grows) |
| Tests + regression | Task 4–5 |

**Note:** Spec §9 “헬퍼 추가” — 구현에서는 `createMementoCore`+`createToolContext`가 이미 `experimental-example`과 동일 역할을 하므로 **별도 헬퍼 파일은 생략**한다. 중복이 커지면 후속 리팩터에서 승격한다.
