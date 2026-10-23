# Enterprise memory governance plan

This plan implements enterprise memory governance for Issue #1094.
It enforces tenant and project boundaries on API tokens.
It adds granular tool scopes for read and write separation.
It enforces zero external leaks in strict offline operation.
It provides audit retention and compliant memory wipe.
The work delivers across four ordered PRs.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator reviews each PR and lands the stack.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [x] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [x] Read these from trunk at program start. Re-read them at every tick.
  - [x] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [x] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [x] `git show origin/main:pstack/skills/control-cli/SKILL.md`
  - [x] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [x] `git show origin/main:pstack/skills/principle-sequence-verifiable-units/SKILL.md`
- [x] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [x] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [x] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [x] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [x] Follow this dependency graph. Start dependent work only after its parent branch is ready.
  - [x] PR-1094-1 branches from `main`.
  - [x] PR-1094-2 after PR-1094-1.
  - [x] PR-1094-3 after PR-1094-2.
  - [x] PR-1094-4 after PR-1094-3.
- [x] Hold the file boundaries. PR-1094-1 touches token config, middleware, and caller scope. PR-1094-2 touches token types and dispatch auth. PR-1094-3 touches offline config and provider factories. PR-1094-4 touches wipe tools and retention repositories.
- [x] Hold the review gate. No PR in this stack changes interactive UI. Every PR is non-interactive backend governance.

### PR mechanics, for every PR

- [x] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [x] Open the PR ready, never draft, per opening-a-pr. Use `gh pr create --base <base-branch>`. A stack child targets its parent branch.
- [x] Run the repo lint and typecheck once before the PR-facing push. Push with hooks on.
- [x] Run `/deslop` before each commit and `/no-comments` before review.
- [x] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [x] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds.

### Verdict and merge, for every PR

- [x] A full swarm runs once, at the code-ready head. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's Verify, live block. The perf lane from its Verify, perf block. Two audit lanes that read the diff and receipts.
- [x] Clean only when every lane is `PASS`. Findings go back to the owner.
- [x] The owner reports STACK-READY. The root appends the PR to the base-branch stack and the operator lands it bottom-up.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through `control-cli`.

- [x] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [x] Start the test server on an ephemeral port. Wait for readiness.
- [x] Deliver input only through HTTP or CLI commands. Name the read-only diagnostics.
- [x] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Bind project scope to API tokens (PR-1094-1)

**Depends on.** None.

**Files.**

- [x] Edit `packages/memento-core/src/shared/types/api-token.ts`.
- [x] Edit `packages/memento-core/src/shared/config/api-tokens.ts`.
- [x] Edit `packages/memento-server/src/server/middleware/resolve-caller.middleware.ts`.
- [x] Edit `packages/memento-core/src/tools/caller-scope.ts`.
- [x] Edit `packages/memento-server/src/server/audit-tool-dispatch.ts`.
- [x] Create `packages/memento-server/src/server/__tests__/project-scope-binding.spec.ts`.

**Build.**

- [x] Add `projectId?: string` to `ApiTokenEntry` and parse it from `MEMENTO_API_TOKENS`.
- [x] Set `req.programmaticAuth.projectId` and verify header matching in `resolveCallerMiddleware`. Return 403 on header mismatch.
- [x] Pass `boundProjectId` through `ToolContext` and enforce in `caller-scope.ts`.

**You see.**

- [x] A request with a project-bound token and a differing `X-Memento-Project-Id` receives HTTP 403 with `project_id does not match the token-bound project`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `project-scope-binding.spec.ts` verifies token parsing, header parity check, and caller scoping. Run `npm test -- packages/memento-server/src/server/__tests__/project-scope-binding.spec.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run standard unscoped token requests at trunk and head. Save `lane-1-unscoped.png`. Pass when status is 200 and behavior is identical.
- [x] Lane 2. Project-bound token without header. Save `lane-2-bound-no-header.png`. Pass when request succeeds and defaults to bound project.
- [x] Lane 3. Project-bound token with matching header. Save `lane-3-matching-header.png`. Pass when request succeeds with 200.
- [x] Lane 4. Project-bound token with conflicting header. Save `lane-4-conflicting-header.png`. Pass when server rejects with 403.
- [x] Lane 5. Unbound token with custom project header. Save `lane-5-unbound-custom-header.png`. Pass when server permits custom project for legacy callers.
- [x] Lane 6. Forget tool with bound project. Save `lane-6-forget-bound-project.png`. Pass when items outside project return not found.
- [x] Lane 7. Remember tool with bound project. Save `lane-7-remember-bound-project.png`. Pass when inserted item carries bound project id.
- [x] Lane 8. Recall tool with bound project filter. Save `lane-8-recall-bound-project.png`. Pass when only project memories appear in search.
- [x] Lane 9. Audit trail verification. Save `lane-9-audit-project.png`. Pass when audit log records bound project id.
- [x] Lane 10. CLI export tool with bound project. Save `lane-10-export-project.png`. Pass when exported memories match bound project.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Middleware execution overhead in microseconds.
- [x] Probe. Run benchmark probe over 1000 requests to `/tools` with bound project token.
- [x] Baseline. Measure trunk resolve-caller middleware latency baseline.
- [x] Rule. Head latency must not exceed trunk by more than 0.15ms per request.

**Review gate.** None. PR-1094-1 is not review-gated.

**Merge.**

- [x] Root clean verdict at head SHA.
- [x] Bugbot triage done.
- [x] Rebased onto current trunk after verdict.
- [x] Root appends PR to base-branch stack.

## Add granular tool read and write scopes (PR-1094-2)

**Depends on.** PR-1094-1.

**Files.**

- [x] Edit `packages/memento-core/src/shared/types/api-token.ts`.
- [x] Edit `packages/memento-server/src/server/auth/api-token-registry.ts`.
- [x] Edit `packages/memento-server/src/server/middleware/programmatic-auth.middleware.ts`.
- [x] Edit `packages/memento-server/src/server/audit-tool-dispatch.ts`.
- [x] Create `packages/memento-server/src/server/__tests__/granular-tool-scopes.spec.ts`.

**Build.**

- [x] Extend `ApiScope` with `tools:read` and `tools:write`.
- [x] In `audit-tool-dispatch.ts`, assert token permits tool action based on `auditActionForTool`.
- [x] Reject mutating tool invocations from `tools:read`-only tokens with HTTP 403.

**You see.**

- [x] Invoking `remember` with a `tools:read` token returns error `scope tools:read does not permit action write`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `granular-tool-scopes.spec.ts` verifies action mapping and rejection of forbidden mutations. Run `npm test -- packages/memento-server/src/server/__tests__/granular-tool-scopes.spec.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run `tools:invoke` super-scope at trunk and head. Save `lane-1-super-scope.png`. Pass when all tools execute normally.
- [x] Lane 2. Recall tool with `tools:read` scope. Save `lane-2-read-recall.png`. Pass when recall succeeds with 200.
- [x] Lane 3. Remember tool with `tools:read` scope. Save `lane-3-read-remember.png`. Pass when invocation is rejected with 403.
- [x] Lane 4. Forget tool with `tools:read` scope. Save `lane-4-read-forget.png`. Pass when invocation is rejected with 403.
- [x] Lane 5. Remember tool with `tools:write` scope. Save `lane-5-write-remember.png`. Pass when memory is saved successfully.
- [x] Lane 6. Recall tool with `tools:write` only. Save `lane-6-write-recall.png`. Pass when read action is rejected.
- [x] Lane 7. Pin and unpin tools with read scope. Save `lane-7-read-pin.png`. Pass when pin mutation is rejected.
- [x] Lane 8. Combined `tools:read` and `tools:write` token. Save `lane-8-dual-scope.png`. Pass when both read and write tools succeed.
- [x] Lane 9. Audit log status check. Save `lane-9-audit-auth-fail.png`. Pass when rejected dispatch is logged as failure with missing scope.
- [x] Lane 10. Admin endpoint safety check. Save `lane-10-admin-isolation.png`. Pass when `admin:destructive` remains strictly segregated.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Tool authorization check duration in microseconds.
- [x] Probe. Interleaved tool dispatch calls comparing `tools:invoke` versus granular check.
- [x] Baseline. Measure trunk tool dispatch authorization check latency.
- [x] Rule. Authorization step must add less than 50 microseconds overhead.

**Review gate.** None. PR-1094-2 is not review-gated.

**Merge.**

- [x] Root clean verdict at head SHA.
- [x] Bugbot triage done.
- [x] Rebased onto parent branch after verdict.
- [x] Root appends PR to base-branch stack.

## Enforce strict offline operation mode (PR-1094-3)

**Depends on.** PR-1094-2.

**Files.**

- [x] Edit `packages/memento-core/src/shared/config/index.ts`.
- [x] Edit `packages/memento-core/src/domains/embedding/embedding-service-factory.ts`.
- [x] Edit `packages/memento-core/src/infrastructure/llm/llm-service-factory.ts`.
- [x] Edit `packages/memento-core/src/shared/utils/network-guard.ts`.
- [x] Create `packages/memento-core/src/__tests__/offline-strict-mode.spec.ts`.

**Build.**

- [x] Add `MEMENTO_OFFLINE_STRICT` boolean configuration option.
- [x] In embedding and LLM factories, throw fatal configuration error if remote provider is selected under offline mode.
- [x] Add network egress boundary assertion preventing external socket connections.

**You see.**

- [x] Server boot with `MEMENTO_OFFLINE_STRICT=true` and `EMBEDDING_PROVIDER=openai` fails immediately with `remote provider openai is forbidden in offline strict mode`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `offline-strict-mode.spec.ts` verifies provider validation and offline assertion. Run `npm test -- packages/memento-core/src/__tests__/offline-strict-mode.spec.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Boot server with default settings at trunk and head. Save `lane-1-default-boot.png`. Pass when boot succeeds without error.
- [x] Lane 2. Boot with offline strict and ONNX MiniLM. Save `lane-2-offline-minilm.png`. Pass when local embedding model initializes successfully.
- [x] Lane 3. Boot with offline strict and local Ollama. Save `lane-3-offline-ollama.png`. Pass when local provider initializes with host loopback.
- [x] Lane 4. Boot with offline strict and OpenAI embedding. Save `lane-4-offline-openai.png`. Pass when boot fails with fatal configuration error.
- [x] Lane 5. Boot with offline strict and Anthropic LLM. Save `lane-5-offline-anthropic.png`. Pass when boot fails with fatal configuration error.
- [x] Lane 6. Local hybrid search run in offline mode. Save `lane-6-offline-search.png`. Pass when hybrid search completes without external calls.
- [x] Lane 7. Offline procedural distillation run. Save `lane-7-offline-procedural.png`. Pass when local summarizer operates without network.
- [x] Lane 8. Network egress trap during memory insertion. Save `lane-8-network-trap.png`. Pass when zero external network packets are observed.
- [x] Lane 9. Healthcheck probe in offline mode. Save `lane-9-offline-health.png`. Pass when `/health` returns healthy and reports mode offline.
- [x] Lane 10. Audit log recording of offline mode. Save `lane-10-offline-audit.png`. Pass when system startup event logs `offline_strict=true`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Server startup and initialization duration in milliseconds.
- [x] Probe. Start server with local ONNX MiniLM ten times and measure ready latency.
- [x] Baseline. Measure trunk startup time with local ONNX MiniLM.
- [x] Rule. Startup time in offline strict mode must not exceed baseline by more than 100ms.

**Review gate.** None. PR-1094-3 is not review-gated.

**Merge.**

- [x] Root clean verdict at head SHA.
- [x] Bugbot triage done.
- [x] Rebased onto parent branch after verdict.
- [x] Root appends PR to base-branch stack.

## Implement compliant retention and secure memory wipe (PR-1094-4)

**Depends on.** PR-1094-3.

**Files.**

- [x] Create `packages/memento-core/src/domains/memory/tools/wipe-memory-tool.ts`.
- [x] Edit `packages/memento-core/src/domains/memory/repositories/memory-item-repository.ts`.
- [x] Edit `packages/memento-core/src/domains/forgetting/repositories/forgetting-event-repository.ts`.
- [x] Edit `packages/memento-server/src/server/routes/admin/admin.routes.ts`.
- [x] Create `packages/memento-core/src/domains/memory/tools/__tests__/wipe-memory-tool.spec.ts`.

**Build.**

- [x] Create `WipeMemoryTool` supporting retention expiration purge and cryptographic zero-fill of vectors.
- [x] Add database transaction ensuring atomic removal across `memory_item`, vector tables, and relations.
- [x] Append immutable audit record with HMAC verifying complete eradication.

**You see.**

- [x] Running wipe on expired soft-deleted memories returns `purged_count` and zeroes out matching vector rows in `memory_item_vec_tfidf`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `wipe-memory-tool.spec.ts` verifies atomic purge, vector zeroing, and audit logging. Run `npm test -- packages/memento-core/src/domains/memory/tools/__tests__/wipe-memory-tool.spec.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run standard soft forget at trunk and head. Save `lane-1-soft-forget.png`. Pass when deleted memory is soft-marked.
- [x] Lane 2. Wipe memory dry run mode. Save `lane-2-wipe-dry-run.png`. Pass when candidate count is returned with zero database mutations.
- [x] Lane 3. Wipe memory with explicit memory id. Save `lane-3-wipe-single-id.png`. Pass when memory and vector row are completely removed.
- [x] Lane 4. Wipe memory retention purge for expired items. Save `lane-4-wipe-retention.png`. Pass when items older than retention window are wiped.
- [x] Lane 5. Retention policy preserving active memories. Save `lane-5-retention-preserve.png`. Pass when active memories remain untouched.
- [x] Lane 6. Wipe memory token boundary check. Save `lane-6-wipe-auth-boundary.png`. Pass when wipe requires `admin:destructive` scope.
- [x] Lane 7. Cryptographic vector row zero-fill verification. Save `lane-7-vector-zeroing.png`. Pass when vector table index has zero remnants.
- [x] Lane 8. Relation graph cascade cleanup. Save `lane-8-relation-cleanup.png`. Pass when orphaned relations are eliminated.
- [x] Lane 9. Audit log entry for wipe operation. Save `lane-9-audit-wipe-record.png`. Pass when audit chain contains cryptographic wipe hash.
- [x] Lane 10. Database vacuum and integrity verification after wipe. Save `lane-10-db-integrity.png`. Pass when `PRAGMA integrity_check` returns ok.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Batch wipe execution throughput in items per second.
- [x] Probe. Purge batch of 500 soft-deleted test memories and measure execution time.
- [x] Baseline. Measure standard batch hard delete latency on 500 items.
- [x] Rule. Wiping 500 items including vector purge and audit chain must complete in under 1.5 seconds.

**Review gate.** None. PR-1094-4 is not review-gated.

**Merge.**

- [x] Root clean verdict at head SHA.
- [x] Bugbot triage done.
- [x] Rebased onto parent branch after verdict.
- [x] Root appends PR to base-branch stack.

## Close the program

- [x] Every box above is checked with its evidence.
- [x] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototypes were executed in this planning phase. Open design questions regarding token project binding and granular scopes were settled by reading existing token binding implementations from Issue #1258 and #1285.

## Appendix B. Alternatives rejected

Alternative 1. Dynamic SQL tenant views. Rejected because SQLite database file level isolation or indexed `project_id` and `owner_id` guards provide simpler boundary semantics without breaking schema migration linearity.

Alternative 2. Pure client parameter project filtering. Rejected because untrusted client parameters allow cross-project memory probing and spoofing. Project scopes must derive from trusted token bindings.

## Appendix C. Risks

Risk 1. Legacy API token compatibility. Tokens without `projectId` or granular scopes must retain existing unscoped `tools:invoke` behavior. Mitigated by keeping `projectId` optional and treating missing scopes as super-scope in PR-1094-1 and PR-1094-2.

Risk 2. Performance regression during batch memory wiping. Purging large volumes of vector rows can cause SQLite table locks. Mitigated by transaction batching in PR-1094-4.

## Appendix D. Links and reading list

- GitHub Issue #1094 at `https://github.com/jee1/memento/issues/1094`.
- Obsidian note at `memento/LLM 자체 기억 시대의 Memento 가치와 미래 전략.md`.
- Token binding reference PR #1261 (Issue #1258)
- Caller scope reference PR #1285
