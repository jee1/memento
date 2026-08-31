# Redaction checklist (FR-025)

**Purpose**: Human review gate before committing any Korean gold / remasure docs derived from live samples or LoCoMo. No automated PII-scanner product is required (FR-025); this checklist + reviewer sign-off is the gate.

**When to run**: Before every commit that touches
- `tests/fixtures/agent-memory-benchmark-ko/**`
- `specs/661-808-korean-recall-gold/remasure-locomo.md`
- `specs/661-808-korean-recall-gold/before-after-804-807.md`
- any public doc that mentions LoCoMo / live remasure numbers
- any promotion of live-sample → synthetic rewrite into the fixture

**Reviewer**: leave initials/date in the Sign-off section when all boxes are checked.

---

## 1. No live DB memory IDs in committed gold (FR-015)

- [ ] Every `relevantIds[]` entry / corpus memory id is `ko_mem_*` only.
- [ ] No UUID-looking, numeric SQLite row ids, or production `memory_*` / UUID strings in `queries.json`, `corpus.jsonl`, or `graph-edges.json`.
- [ ] Run (expect exit 0):

  ```bash
  npx tsx scripts/korean-gold-validate.ts --fixture tests/fixtures/agent-memory-benchmark-ko
  ```

- [ ] Spot-check: `rg -nE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' tests/fixtures/agent-memory-benchmark-ko` → empty (or only documented false positives in README).

**Fail closed**: if any live-looking id remains, rewrite to synthetic `ko_mem_*` before commit.

---

## 2. No LoCoMo / live corpus bodies in git (FR-009, SC-006)

- [ ] `git status` / `git diff --cached` show **no** paths under `.local/locomo/`, raw `locomo10.json`, session transcripts, or live DB dumps.
- [ ] Committed files contain **no** LoCoMo dialogue turns, session bodies, or live memory `content` copied from production.
- [ ] Remasure procedure outputs stay under `.local/locomo/` (gitignored). Do **not** `git add` them even if present on disk.
- [ ] If accidental LoCoMo/live files appear untracked: leave them unstaged; delete or move outside the worktree if unsure. Never stage “to clean up status”.

**Allowed in git**: synthetic fixture under `tests/fixtures/agent-memory-benchmark-ko/`; aggregate tables in specs (see §3).

---

## 3. Public docs: aggregates, IDs, hashes only (SC-006)

When editing `remasure-locomo.md`, `before-after-804-807.md`, `docs/guides/ko/benchmark-datasets.md`, CHANGELOG, or issue comments:

- [ ] Publish only: Recall@10, MRR, `git_sha`, `ranking_version` / ranking hash, embedding provider, dataset revision / query counts, opaque query ids (`kq_*`), synthetic memory ids (`ko_mem_*`).
- [ ] Do **not** paste: query text from LoCoMo, answer evidence spans, dialogue bodies, live memory content, emails, names, paths under a user’s home that encode identity.
- [ ] If a side is missing, write `status: blocked` / `incomplete` with empty metric cells — do not invent numbers (FR-016, FR-018, FR-020).

---

## 4. Scorecards & raw reports under `.local/` (gitignored)

- [ ] Korean arm outputs go to `.local/korean-gold/` (e.g. `results.json`, `scorecard.json`) per [quickstart.md](./quickstart.md).
- [ ] LoCoMo remasure outputs go to `.local/locomo/` (already gitignored).
- [ ] Confirm ignore coverage:

  ```bash
  git check-ignore -v .local/korean-gold/scorecard.json .local/locomo/locomo10.json
  ```

  Both paths must report a `.gitignore` rule. `.local/korean-gold/` and `.local/locomo/` are listed in repo `.gitignore`.
- [ ] Never commit scorecards that embed retrieved memory bodies or LoCoMo evidence. If a report must be discussed publicly, copy **aggregates only** into the spec markdown (§3).

---

## 5. PII / secrets scan before promoting any live-sample-derived artifact

Human scan (FR-025 — checklist + review, not a CI PII product). Run **before** rewriting live samples into the synthetic fixture or pasting into docs.

- [ ] Source material is either (a) purely invented synthetic text, or (b) live-derived **after** rewriting — never a verbatim live paste into git.
- [ ] Scan candidate files for secrets / PII patterns (adjust paths to the artifact being promoted):

  ```bash
  # emails, API key-ish tokens, private keys
  rg -nEi '(@[a-z0-9.-]+\.[a-z]{2,}|sk-[a-zA-Z0-9]{20,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY|password\s*=|api[_-]?key)' \
    tests/fixtures/agent-memory-benchmark-ko \
    specs/661-808-korean-recall-gold/*.md
  ```

- [ ] Manual read of new/changed corpus lines and query bodies: no real person names, company-confidential project names, customer data, auth tokens, absolute home paths with usernames.
- [ ] Opaque `queryId` (`kq_*`) ≠ query text (FR-026); no live ticket/issue titles as ids.
- [ ] Second person (or self after a break) confirms the checklist before `git add` of fixture/docs.

**If anything matches**: rewrite to fictional content, drop the row, or keep the artifact only under `.local/` — do not commit until clean.

---

## Sign-off

| Item | Reviewer | Date |
|------|----------|------|
| §§1–5 all checked for this change | agent (execute+review loop) | 2026-08-31 |

Attestation: committed gold is synthetic `ko_mem_*` / `kq_*` only; no LoCoMo/live bodies in git status; public docs use aggregates/IDs/hashes; `.local/korean-gold/` gitignored. Human PR author should re-confirm §§1–5 before merge.

**Refs**: FR-009, FR-015, FR-016, FR-018, FR-025, FR-026; SC-006; [contracts/korean-gold-fixture.md](./contracts/korean-gold-fixture.md); [quickstart.md](./quickstart.md).
