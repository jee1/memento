# Obsidian graph UX into Memento dashboard plan

Issue [#1364](https://github.com/jee1/memento/issues/1364) tracks bringing Obsidian Graph View interaction patterns into the Admin 앵커 맵 and 기억 그래프. Operators get neighbor focus, directed edges, local depth, and relation-type filters without copying Obsidian source. The program enforces pattern adoption only, copyright-safe reimplementation in our D3 stack. PR order is PR1 then PR2. Force sliders stay out until a jank measurement opens a later issue.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The root leaves PR1 and PR2 merge-ready. The operator lands the stack bottom-up.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] Control skill path for browser UI when present in trunk under cursor-team-kit `control-ui`
  - [ ] `git show origin/main:docs/agents/plans/1364-obsidian-graph-ux.md`
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR1 is first. Branches from `main`.
  - [ ] PR2 after PR1.
- [ ] Hold the file boundaries. PR1 touches hover or dim helpers, memory-graph arrow rendering, matching CSS, and tests. PR2 touches local-depth mode, `relation_types` UI wiring, and related fetch or HTML only.
- [ ] Hold the review gate. PR1 and PR2 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends each PR to the base-branch stack. The operator lands bottom-up. Patch-id rules from `playbooks/shipping.md` apply.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Start HTTP admin with `npm run dev:http`. Wait until the dashboard serves `static/dashboard.html`.
- [ ] Deliver input only through the control skill's commands. Name the read-only diagnostics.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Add hover neighbor dim and memory-graph arrows (PR1)

**Depends on.** None.

**Files.**

- [ ] Edit `static/js/graph-render.js`.
- [ ] Edit `static/js/graph-search.js` if dim classes need to compose with search-dim.
- [ ] Edit `static/js/anchor-map-render.js`.
- [ ] Edit `static/css/dashboard.css` and `static/graph.html` styles for dim and arrow markers only.
- [ ] Create or edit a Vitest or node:vm harness under `tests/` that covers neighbor sets and arrow marker attachment.

**Build.**

- [ ] On node hover or focus, dim non-neighbor nodes and edges on both tabs. Keep the hovered node and its one-hop neighbors bright. Clear dim on mouseout or blur. On the memory graph only, draw directed arrowheads from `source` to `target`. Do not put arrows on anchor hop lines.

**You see.**

- [ ] Hovering a node dims non-neighbors on both tabs. Memory graph edges show direction. Anchor hop lines stay undirected.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Harness asserts neighbor set membership for a three-node line and asserts SVG marker presence for a directed edge. Run the repo test command that covers the new harness file.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-high-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open 기억 그래프, load data, hover a node. On trunk record tooltip-only hover. On head record neighbor dim. Save `pr1-regression-hover.png`. Pass when head shows dim on non-neighbors and both sides open the tab without console errors.
- [ ] Lane 2. 기억 그래프 hover dim. Save `pr1-graph-hover.png`. Pass when non-neighbors carry the dim class.
- [ ] Lane 3. 기억 그래프 mouseout clears dim. Save `pr1-graph-clear.png`. Pass when dim classes are gone after mouseout.
- [ ] Lane 4. 기억 그래프 arrows. Save `pr1-graph-arrows.png`. Pass when edge markers point from source toward target on a known fixture.
- [ ] Lane 5. 앵커 맵 hover dim. Save `pr1-anchor-hover.png`. Pass when non-neighbors dim.
- [ ] Lane 6. 앵커 맵 has no new arrowheads on hop lines. Save `pr1-anchor-no-arrows.png`. Pass when hop strokes remain undirected.
- [ ] Lane 7. Search-dim still works with focus dim. Save `pr1-search-compose.png`. Pass when an active search still marks matches.
- [ ] Lane 8. Click still opens detail. Save `pr1-click-detail.png`. Pass when detail panel shows the clicked node.
- [ ] Lane 9. Drag and zoom still work. Save `pr1-drag-zoom.png`. Pass when a dragged node moved and zoom transform is non-identity.
- [ ] Lane 10. Diff stays inside declared files with no Obsidian source. Save `pr1-diff-stat.png`. Pass when `git diff --stat` lists only declared paths.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Hover handler wall time for a graph with at least 100 nodes, measured at trunk and head. Also name the end-to-end time until dim classes settle.
- [ ] Probe. Interleaved Performance.now around the hover handler at trunk and head on the same fixture size.
- [ ] Baseline. Record the trunk hover handler milliseconds first.
- [ ] Rule. Head hover handler must stay under 16ms on the 100-node fixture, or under 1.5x trunk if trunk already exceeds 16ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 4 screenshots into `docs/agents/plans/media/1364-pr1-review.png`.
- [ ] Record a 30 to 60 second video of hover dim and arrows. Save it as `docs/agents/plans/media/1364-pr1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR1 to the stack. The operator lands it.

## Add memory-graph local depth and relation-type filter (PR2)

**Depends on.** PR1.

**Files.**

- [ ] Edit `static/graph.html` for local-depth controls and relation-type checkboxes or multi-select.
- [ ] Edit `static/js/graph.js`, `static/js/graph-fetch.js`, and `static/js/graph-shared.js`.
- [ ] Edit `static/js/graph-render.js` only if client-side depth trimming needs a helper.
- [ ] Edit matching CSS in `static/graph.html` or `static/css/dashboard.css`.
- [ ] Edit or add tests for URL query building and depth trimming.

**Build.**

- [ ] Add a local mode on the memory graph. After the operator picks a focus node, keep only nodes within depth 1 to 3. Wire `relation_types` from the UI into `buildUrl` so `GET /admin/graph` receives the existing server filter. Do not invent attachment or vault-file filters. Leave Anchor Map slot hops unchanged.

**You see.**

- [ ] Choosing a focus node and depth 2 shrinks the canvas to that neighborhood. Toggling a relation type changes which edges remain. Network panel shows `relation_types` on the graph request.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Unit test covers depth trimming on a small fixture and asserts `buildUrl` includes `relation_types`. Run the matching Vitest file.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-high-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Load the default memory graph on trunk and head. Save `pr2-regression-default.png`. Pass when both still load without console errors and head defaults match trunk node count within fixture noise.
- [ ] Lane 2. Enter local mode at depth 1 from a chosen node. Save `pr2-depth-1.png`. Pass when only the focus node and its direct neighbors remain.
- [ ] Lane 3. Raise depth to 3. Save `pr2-depth-3.png`. Pass when the visible set grows versus lane 2 without returning the full global graph on a large fixture.
- [ ] Lane 4. Exit local mode restores the prior global or capped view. Save `pr2-exit-local.png`. Pass when node count returns to the non-local baseline.
- [ ] Lane 5. Relation-type filter hides unmatched edges. Save `pr2-relation-filter.png`. Pass when only selected relation types remain.
- [ ] Lane 6. Network request includes `relation_types`. Save `pr2-network.png`. Pass when the graph fetch query string carries the selected types.
- [ ] Lane 7. Orphan toggle still works with local mode off. Save `pr2-orphan.png`. Pass when degree-zero nodes hide as before.
- [ ] Lane 8. Anchor Map slot A/B/C behavior unchanged. Save `pr2-anchor-slots.png`. Pass when slot hops still drive the anchor map without new depth chrome.
- [ ] Lane 9. Hover dim from PR1 still works in local mode. Save `pr2-hover-local.png`. Pass when non-neighbors dim inside the trimmed set.
- [ ] Lane 10. Diff stays inside file boundaries. Save `pr2-diff-stat.png`. Pass when `git diff --stat` lists only declared paths.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from depth change to SVG update complete, trunk global load versus head local depth-2 on the same fixture seed.
- [ ] Probe. Interleaved Performance.now around the depth apply path at head, and around the default load at trunk.
- [ ] Baseline. Record trunk default load milliseconds first.
- [ ] Rule. Head depth-2 apply stays under 100ms on the standard dashboard fixture, and under the trunk default load time when the local set is smaller than the global set.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 5 screenshots into `docs/agents/plans/media/1364-pr2-review.png`.
- [ ] Record a 30 to 60 second video of local depth and relation filter. Save it as `docs/agents/plans/media/1364-pr2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends PR2 onto PR1. The operator lands after PR1.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

REA slim simulation app analysis Evidence id `ev_94bd5eb11cd51d8a92222ed6785d9d86a0a4b58f3a38a89a77ee590a80bbe74c` for `sim-app` under `.local/rea-obsidian-graph/`. Observed Worker message fields include `nodes`, `links`, `forceNode`, `forces.centerStrength`, `forces.linkStrength`, `forces.linkDistance`, `forces.repelStrength`, `alpha`, `alphaTarget`, and `run`. Full `/opt/Obsidian/resources/obsidian.asar` analysis timed out past five minutes. UI surface inventory used Obsidian i18n keys `plugins.graph-view.*` and CSS classes `.graph-controls`, `.graph-control-section`, `.graph-view`.

Dashboard inventory confirmed PR1 gaps at Anchor (no mouseover dim in `anchor-map-render.js`) and Memory Graph (tooltip only at `graph-render.js:99`, search-dim at `graph-search.js:53`). `relation_types` is accepted by `admin-graph.routes.ts` but `graph-fetch.js` does not send it. Gap matrix from the Experience First pass ranked hover dim, local depth, arrows, and relation filter above force sliders. No throwaway HTML prototype branch yet. Hover dim and arrows remain unproven until PR1 live lanes.

## Appendix B. Alternatives rejected

Porting Obsidian `sim.js` was rejected for copyright and because memento already uses d3-force. Force sliders, color groups, timelapse, screenshot copy, and bookmark-graph naming were rejected for the first stack under Experience First. They do not tighten the recall inspection loop. A single mega-PR was rejected under sequence-verifiable-units. Neighbor-links toggle was rejected because hover dim covers the same job without emptying the canvas.

## Appendix C. Risks

Copyright leakage if a contributor pastes Obsidian source. Owners watch diffs for vendor comments. Local depth that silently drops high-value distant nodes may confuse operators. PR2 must show the focus node and depth clearly. Wrong arrows on undirected anchor hops would lie. PR1 forbids arrows on hop lines. Main-thread jank on full 5000-node load is a later issue only after a measured tick budget failure.

## Appendix D. Links and reading list

Issue https://github.com/jee1/memento/issues/1364. Local REA notes under `.local/rea-obsidian-graph/` (gitignored). Dashboard entry `static/dashboard.html`. Anchor map `static/js/anchor-map.js`. Memory graph `static/js/graph-render.js` and `static/js/graph-fetch.js`. Trail skill `pstack/skills/show-me-your-work/SKILL.md`.
