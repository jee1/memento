# Issue 766 `memento-mcp` bin Alias Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the colliding `memento-mcp` CLI bin alias so the only stdio MCP CLI name is `memento-mcp-server`, with Breaking CHANGELOG and current-doc cleanup (#766, Epic #770 / #763 prerequisite).

**Architecture:** Declarative package surface change only. Add a small Vitest regression that locks the published/root and workspace-server `bin` maps. Delete the alias from both `package.json` files, sync the lockfile, document the break, and scrub current user-facing docs that still advertise the alias. No runtime shim; no `memento-mcp.lock` rename; no historical `_work` rewrites.

**Tech Stack:** npm package.json `bin`, package-lock.json, Vitest, Keep a Changelog, Markdown docs

**Spec:** `docs/superpowers/specs/2026-08-15-issue-766-memento-mcp-bin-alias-design.md`

---

## File Structure Map

| File | Responsibility |
|---|---|
| Create: `tests/package-bin-brand.spec.ts` | Regression: root + `memento-server` bins must include `memento-mcp-server`, must not include `memento-mcp` |
| Modify: `package.json` | Remove `bin.memento-mcp` |
| Modify: `packages/memento-server/package.json` | Remove `bin.memento-mcp` |
| Modify: `package-lock.json` | Sync bin maps after package.json edit |
| Modify: `CHANGELOG.md` | `[Unreleased]` → `### Breaking` entry for alias removal |
| Modify: `docs/reference/ko/memento-repository-current-state-report.md` | Drop “또는 memento-mcp” / dual-bin listing |
| Modify: `scripts/verify-bin.js` | Fail publish if forbidden alias `memento-mcp` reappears on root bin |
| Reference only: `README.md`, `INSTALL.md`, `INSTALL.en.md`, `install.sh` | Confirm already use `memento-mcp-server` (no edit unless grep finds alias) |

---

### Task 1: Failing regression test for bin brand

**Files:**
- Create: `tests/package-bin-brand.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/package-bin-brand.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readBin(packageJsonPath: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    bin?: Record<string, string>;
  };
  if (!pkg.bin || typeof pkg.bin !== 'object') {
    throw new Error(`missing bin in ${packageJsonPath}`);
  }
  return pkg.bin;
}

describe('CLI bin brand (#766)', () => {
  it('root package.json keeps memento-mcp-server and drops memento-mcp alias', () => {
    const bin = readBin(join(root, 'package.json'));
    expect(bin['memento-mcp-server']).toBe('./dist/server/index.js');
    expect(bin).not.toHaveProperty('memento-mcp');
  });

  it('memento-server package.json keeps memento-mcp-server and drops memento-mcp alias', () => {
    const bin = readBin(join(root, 'packages/memento-server/package.json'));
    expect(bin['memento-mcp-server']).toBe('./dist/server/index.js');
    expect(bin).not.toHaveProperty('memento-mcp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/package-bin-brand.spec.ts
```

Expected: FAIL — both cases still have `memento-mcp` property (alias present).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/package-bin-brand.spec.ts
git commit -m "$(cat <<'EOF'
test(brand): add failing bin alias regression for #766

EOF
)"
```

---

### Task 2: Remove `memento-mcp` from package bin maps

**Files:**
- Modify: `package.json` (root `bin` block)
- Modify: `packages/memento-server/package.json` (`bin` block)
- Modify: `package-lock.json`

- [ ] **Step 1: Edit root `package.json` bin**

Replace the root `bin` object so it no longer includes `memento-mcp`:

```json
  "bin": {
    "memento-mcp-server": "./dist/server/index.js",
    "memento-dev": "./dist/server/http-server.js",
    "memento-setup": "./scripts/auto-setup.js"
  },
```

Do not rename or remove `memento-mcp-server`, `memento-dev`, or `memento-setup`.

- [ ] **Step 2: Edit `packages/memento-server/package.json` bin**

Replace the server package `bin` object:

```json
  "bin": {
    "memento": "./dist/cli.js",
    "memento-mcp-server": "./dist/server/index.js",
    "memento-dev": "./dist/server/http-server.js"
  },
```

Keep `memento` and `memento-dev`; only delete the `memento-mcp` line.

- [ ] **Step 3: Sync lockfile bin entries**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` no longer lists `"memento-mcp": "dist/server/index.js"` under the root package `bin` maps (search to confirm zero matches for that key under bin).

Verify:

```bash
rg '"memento-mcp"' package.json packages/memento-server/package.json package-lock.json
```

Expected: no matches in those three files (or only unrelated non-bin strings — preferably zero).

- [ ] **Step 4: Run regression test — expect PASS**

Run:

```bash
npm test -- tests/package-bin-brand.spec.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add package.json packages/memento-server/package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(brand): remove colliding memento-mcp bin alias (#766)

EOF
)"
```

---

### Task 3: Harden `verify-bin.js` against alias regression

**Files:**
- Modify: `scripts/verify-bin.js`

- [ ] **Step 1: Add forbidden-alias check after `bin` is loaded**

Immediately after `const bin = packageJson.bin;` (and the existing missing-bin guard), add:

```javascript
const FORBIDDEN_BIN_ALIASES = ['memento-mcp'];

for (const forbidden of FORBIDDEN_BIN_ALIASES) {
  if (Object.prototype.hasOwnProperty.call(bin, forbidden)) {
    console.error(
      `❌ forbidden bin alias "${forbidden}" collides with unrelated packages; use memento-mcp-server (#766)`
    );
    hasErrors = true;
  }
}
```

Note: `hasErrors` is declared later in the current file. Move `let hasErrors = false;` to **before** this loop (above the forbidden check), then keep the existing per-entry loop unchanged.

- [ ] **Step 2: Smoke the verifier**

Run:

```bash
node -e "
import { readFileSync, writeFileSync } from 'fs';
const p='package.json';
const j=JSON.parse(readFileSync(p,'utf8'));
const backup=JSON.stringify(j,null,2)+'\n';
j.bin['memento-mcp']='./dist/server/index.js';
writeFileSync(p, JSON.stringify(j,null,2)+'\n');
"
```

Then:

```bash
npm run verify-bin; echo EXIT:$?
```

Expected: non-zero exit and error mentioning forbidden alias / #766.

Restore immediately:

```bash
git checkout -- package.json
```

Then:

```bash
npm run verify-bin; echo EXIT:$?
```

Expected: EXIT:0 (or only shebang warnings — must not fail on forbidden alias).

If the temporary mutate approach is awkward in the agent environment, instead temporarily add the alias by hand, run verify-bin (expect fail), then remove it again before committing.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-bin.js
git commit -m "$(cat <<'EOF'
chore(brand): reject memento-mcp bin alias in verify-bin (#766)

EOF
)"
```

---

### Task 4: CHANGELOG Breaking + current docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/reference/ko/memento-repository-current-state-report.md`
- Reference check: `README.md`, `README.en.md` (if present), `INSTALL.md`, `INSTALL.en.md`, `install.sh`, `AGENTS.md`

- [ ] **Step 1: Add Breaking section under `[Unreleased]`**

Insert **above** the first `### Changed` under `## [Unreleased]`:

```markdown
### Breaking

- **CLI bin alias `memento-mcp` removed** (#766): use `memento-mcp-server` only (same stdio entrypoint). The short alias collided with the unrelated npm/GitHub project `gannonh/memento-mcp`. Update MCP host configs and scripts that invoked `memento-mcp`. npm package name remains `memento-mcp-server`.
```

Keep existing Changed/Fixed/Added entries intact.

- [ ] **Step 2: Patch current-state report bin listing**

In `docs/reference/ko/memento-repository-current-state-report.md`:

1. Around the `**bin**:` list, change:

```markdown
  - `memento-mcp-server`, `memento-mcp` → `dist/server/index.js` (stdio MCP 서버)
```

to:

```markdown
  - `memento-mcp-server` → `dist/server/index.js` (stdio MCP 서버)
```

2. In §4.2 stdio MCP, change:

```markdown
  - 한 프로세스당 하나의 MCP 서버. Cursor, Claude Desktop 등에서 `memento-mcp-server`(또는 `memento-mcp`)를 stdio 전송으로 실행해 연결.
```

to:

```markdown
  - 한 프로세스당 하나의 MCP 서버. Cursor, Claude Desktop 등에서 `memento-mcp-server`를 stdio 전송으로 실행해 연결.
```

- [ ] **Step 3: Grep current guides for leftover alias advertising**

Run:

```bash
rg -n '`memento-mcp`|"memento-mcp"|memento-mcp[^-a-zA-Z]' README.md README.en.md INSTALL.md INSTALL.en.md install.sh AGENTS.md docs/guides docs/reference docs/agents --glob '!**/benchmark-v3/**' --glob '!**/_work/**'
```

Expected actionable hits: none in user-facing current docs (ignore `memento-mcp-server`, `memento-mcp.lock`, fixture corpus). If a current guide still advertises the short CLI, edit it to `memento-mcp-server` in the same commit. Do **not** rewrite `docs/_work/**` or dated historical plans.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/reference/ko/memento-repository-current-state-report.md
# plus any extra current docs touched in Step 3
git commit -m "$(cat <<'EOF'
docs(brand): document memento-mcp bin removal (#766)

EOF
)"
```

---

### Task 5: Final verification + PR prep notes

**Files:** none required (verification only)

- [ ] **Step 1: Run gates**

```bash
npm test -- tests/package-bin-brand.spec.ts
npm run verify-bin
npm run type-check
npm run lint
```

Expected: all pass (lint/type-check unchanged by this chore).

Optional smoke (if time):

```bash
npm test -- tests/integrations/smoke.spec.ts
```

Expected: PASS — stdio blocks still reference `memento-mcp-server`.

- [ ] **Step 2: Final brand grep on package surfaces**

```bash
rg '"memento-mcp"' package.json packages/memento-server/package.json package-lock.json scripts/verify-bin.js
```

Expected: only the forbidden-alias string inside `scripts/verify-bin.js` (as the deny-list entry), not as a live bin key.

- [ ] **Step 3: Confirm out-of-scope untouched**

```bash
rg -n "memento-mcp\.lock" packages/memento-server/src/server/utils/instance-lock.ts
```

Expected: lock basename still `memento-mcp.lock` (intentional).

- [ ] **Step 4: Stop for human PR**

Do not push/create PR unless asked. When creating PR later:

- Title: `chore(brand): remove colliding memento-mcp bin alias (#766)`
- Body must include `Fixes #766` and mention Epic #770 / unlocks #763
- No graphify rebuild required unless a `.ts`/`.js` production path beyond `scripts/verify-bin.js` changes; if only script+json+docs, skip graphify

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| Hard-delete `memento-mcp` bin (root + server) | Task 2 |
| Canonical CLI = `memento-mcp-server` | Task 1 + 2 |
| CHANGELOG Breaking / migration | Task 4 |
| Current docs consistency | Task 4 |
| Lockfile sync | Task 2 |
| No npm package rename / logo / lock rename / `_work` | Explicit non-tasks; Task 5 confirms lock untouched |
| #763 prerequisite readiness | Achieved when Tasks 1–5 green |
| Regression prevention | Task 1 (vitest) + Task 3 (verify-bin) |

## Placeholder / consistency self-check

- No TBD/TODO left in steps.
- Forbidden alias name is consistently `memento-mcp`; replacement consistently `memento-mcp-server`.
- Commit messages use `chore(brand)` / `docs(brand)` / `test(brand)` and cite `#766`.
