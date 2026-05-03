# 문서·코드 동기화 및 자동화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [스펙 `docs/superpowers/specs/2026-05-03-doc-sync-automation-design.md`](../specs/2026-05-03-doc-sync-automation-design.md)에 따라, 문서 전수 검수를 **git worktree**로 격리하고, **상대 링크 무결성**과 **문서에 인용된 `npm run` 스크립트 존재**를 CI에서 기계 검증하며, 운영 문서에 **워크플로·체크리스트**를 남긴다.

**Architecture:** 기존 `scripts/audit-markdown-links.mjs`와 `npm run docs:audit-links`를 CI에 편입한다. 루트 및 npm workspaces 각 `package.json`의 `scripts` 키를 집계하는 **신규 Node 스크립트**로 문서 내 `npm run <name>` 인용을 검증한다. 사람 검수 순서·생성물(graphify) 처리 원칙은 운영 가이드와 체크리스트 마크다운으로 고정한다.

**Tech Stack:** Node.js 24, Git worktree, GitHub Actions(`ci.yml`), 저장소 기존 ESM 스크립트 스타일.

---

## 파일 맵 (이 계획이 다루는 경로)

| 경로 | 역할 |
|------|------|
| `docs/operations/ko/doc-audit-workflow.md` | 워크트리 생성·브랜치·graphify 재생성·PR 요약 항목 |
| `docs/operations/ko/doc-audit-checklist.md` | 전수 검수 순서별 체크박스(스펙 섹션 7 정렬) |
| `scripts/verify-doc-npm-scripts.mjs` | 마크다운에서 `npm run <script>` 추출 후 스크립트명 집합과 대조 |
| `package.json` | `docs:verify-npm-scripts` 스크립트 추가 |
| `.github/workflows/ci.yml` | `lint-typecheck` job에 문서 검증 스텝 추가 |
| `docs/README.md` | 운영 가이드로 링크 한 줄(선택이 아니라 권장: 포털에서 발견 가능하게) |

**생성물 경로(재생성 우선, 스펙 3.2):** 루트 `graphify-out/`, `packages/memento-core/graphify-out/` — 체크리스트와 워크플로에 명시만 하고, 본 계획의 코드 작업에서는 **수동 대량 수정을 가정하지 않는다**.

**예외 `.md` 목록(스펙 3.1):** 초기값은 빈 목록으로 두고, `verify-doc-npm-scripts.mjs` 상단의 `ALLOWLIST` 또는 동일 파일 내 배열로만 관리한다. 벤더 복사본 등이 나오면 **첫 PR에서 경로를 추가**한다.

---

### Task 1: 운영 워크플로 문서 추가

**Files:**
- Create: `docs/operations/ko/doc-audit-workflow.md`

- [ ] **Step 1: 파일 생성 및 아래 본문 전체를 붙여 넣는다**

```markdown
# 문서 전수 검수 워크플로 (git worktree)

## 목적

기능 개발 워크스페이스와 분리하여 문서만 수정·검증하고 PR을 낸다. 생성물(`graphify-out/` 등)은 **재생성**으로 맞춘다.

## 1. worktree 추가

저장소 루트에서(경로는 팀에 맞게 조정):

```bash
git fetch origin
git worktree add ../memento-docs-audit origin/main
cd ../memento-docs-audit
```

`main` 대신 `develop` 등 정책 브랜치를 쓰는 경우 스펙의 기준 브랜치에 맞춘다.

## 2. 문서 전용 브랜치

```bash
git switch -c docs/audit-$(date +%Y-%m-%d)
```

## 3. graphify 등 생성물

코드 변경이 포함된 경우, 루트에서(가상환경·의존성은 [AGENTS.md](../../../AGENTS.md) 및 graphify 스킬 따름):

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

생성 diff만 별도 커밋으로 두면 리뷰가 쉽다.

## 4. 기계 검증 (로컬)

```bash
npm ci
npm run docs:audit-links
npm run docs:verify-npm-scripts
npm run lint
npm run type-check
npm run test
```

문서만 바꾼 PR이라도 팀 정책에 따라 위를 최소한 `docs:audit-links`와 `docs:verify-npm-scripts`까지 실행한다.

## 5. PR 본문에 넣을 요약

- 검수 범위: 사람 유지 문서 / 생성물 재생성 여부
- `npm run docs:audit-links` / `docs:verify-npm-scripts` 결과
- 의도적 보류 항목은 이슈 번호 링크
```

- [ ] **Step 2: 커밋**

```bash
git add docs/operations/ko/doc-audit-workflow.md
git commit -m "docs(ops): add doc audit git worktree workflow (KO)"
```

---

### Task 2: 전수 체크리스트 추가

**Files:**
- Create: `docs/operations/ko/doc-audit-checklist.md`

- [ ] **Step 1: 파일 생성 및 아래 본문 전체를 붙여 넣는다**

```markdown
# 문서 전수 검수 체크리스트

스펙: [doc-sync-automation-design.md](../../superpowers/specs/2026-05-03-doc-sync-automation-design.md)

각 항목은 처리 시 `[x]`로 표시한다. 보류 시 이슈 번호를 옆에 적는다.

## 사람 유지 문서 (SSOT)

- [ ] 루트 `README.md`, `README.en.md`
- [ ] `docs/README.md`
- [ ] `AGENTS.md`, `DEVELOPMENT_RULES.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `GEMINI.md`
- [ ] `CHANGELOG.md` (릴리스 절차와 모순 없는지)
- [ ] `docs/guides/` (ko/en)
- [ ] `docs/api/` (ko/en)
- [ ] `docs/architecture/`, `docs/operations/`, `docs/reference/`, `docs/integrations/`
- [ ] `packages/*/README.md`, `apps/*/README.md`
- [ ] `docs/superpowers/specs/`, `docs/superpowers/plans/` (제품 문서와 충돌 시 제품 문서 우선)

## 생성·파생 문서

- [ ] `graphify-out/` — 재생성 후 diff만 반영, 임의 수동 편집 최소화
- [ ] `packages/memento-core/graphify-out/` — 동일

## 마무리

- [ ] `npm run docs:audit-links` 통과
- [ ] `npm run docs:verify-npm-scripts` 통과 (오탐이면 스크립트 상단 ALLOWLIST에 경로·스크립트명 근거와 함께 추가)
- [ ] PR 본문에 워크플로 문서의 요약 항목 포함
```

- [ ] **Step 2: 커밋**

```bash
git add docs/operations/ko/doc-audit-checklist.md
git commit -m "docs(ops): add doc audit checklist (KO)"
```

---

### Task 3: `scripts/verify-doc-npm-scripts.mjs` 추가

**Files:**
- Create: `scripts/verify-doc-npm-scripts.mjs`
- Modify: `package.json` (scripts 섹션)

- [ ] **Step 1: 스크립트 파일 생성**

아래 내용을 `scripts/verify-doc-npm-scripts.mjs`에 그대로 저장한다.

```javascript
#!/usr/bin/env node
/**
 * 모든 .md에서 `npm run <script>` 패턴을 찾아, <script>가 루트 또는 workspace
 * package.json의 scripts에 존재하는지 검사한다.
 * 제외 디렉터리: node_modules, dist, .git
 *
 * 오탐(문서에만 등장하는 가상 명령 등): 아래 ALLOWLIST_NAMES에 스크립트명 추가.
 *
 * 사용: node scripts/verify-doc-npm-scripts.mjs
 * 종료 코드: 미정의 스크립트 인용이 있으면 1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** 문서에만 허용할 npm 스크립트명 (실제 package.json에 없을 때만 추가) */
const ALLOWLIST_NAMES = new Set([
  // 예: 'legacy-example-script'
]);

function shouldSkipDir(parts) {
  return parts.some((p) => SKIP_DIRS.has(p));
}

function* walkMarkdownFiles(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const name = e.name;
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walkMarkdownFiles(full, relPath);
    } else if (name.endsWith('.md')) {
      yield { full, relPath };
    }
  }
}

function* workspaceDirs(rootPkg) {
  const ws = rootPkg.workspaces;
  if (!Array.isArray(ws)) return;
  for (const w of ws) {
    if (w.endsWith('/*')) {
      const relDir = w.slice(0, -2);
      const abs = path.join(ROOT, relDir);
      if (!fs.existsSync(abs)) continue;
      for (const sub of fs.readdirSync(abs, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          yield path.join(relDir, sub.name);
        }
      }
    } else {
      yield w;
    }
  }
}

function collectAllScriptNames() {
  const names = new Set();
  const rootPath = path.join(ROOT, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  for (const k of Object.keys(rootPkg.scripts ?? {})) {
    names.add(k);
  }
  for (const dir of workspaceDirs(rootPkg)) {
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const k of Object.keys(pkg.scripts ?? {})) {
      names.add(k);
    }
  }
  return names;
}

const NPM_RUN_RE = /npm\s+run\s+([a-z0-9][a-z0-9:-]*)/gi;

function findUnknownRuns(mdText, known) {
  const unknown = new Set();
  let m;
  const re = new RegExp(NPM_RUN_RE.source, NPM_RUN_RE.flags);
  while ((m = re.exec(mdText)) !== null) {
    const name = m[1];
    if (ALLOWLIST_NAMES.has(name)) continue;
    if (!known.has(name)) unknown.add(name);
  }
  return unknown;
}

function main() {
  const known = collectAllScriptNames();
  const files = [...walkMarkdownFiles(ROOT)];
  const problems = [];

  for (const { full, relPath } of files) {
    const text = fs.readFileSync(full, 'utf8');
    const bad = findUnknownRuns(text, known);
    for (const name of bad) {
      problems.push({ file: relPath, script: name });
    }
  }

  console.log(
    `Known npm scripts (union): ${known.size}; scanned ${files.length} markdown files.`,
  );
  if (problems.length === 0) {
    console.log('All npm run <script> references in .md match a workspace script name.');
    process.exit(0);
  }

  console.error(`\nUnknown npm scripts cited in markdown (${problems.length}):\n`);
  for (const p of problems) {
    console.error(`  ${p.file}: npm run ${p.script}`);
  }
  console.error(
    '\nFix docs, add script to package.json, or add name to ALLOWLIST_NAMES with comment in commit.',
  );
  process.exit(1);
}

main();
```

- [ ] **Step 2: `package.json`의 `"scripts"`에 한 줄 추가**

`"docs:audit-links"` 줄 근처에 다음을 넣는다(쉼표 포함 위치 주의).

```json
    "docs:verify-npm-scripts": "node scripts/verify-doc-npm-scripts.mjs",
```

- [ ] **Step 3: 로컬 실행으로 실패 여부 확인**

```bash
npm run docs:verify-npm-scripts
```

기대: 처음에는 문서에 오래된 스크립트명이 있으면 **exit code 1**과 파일 목록이 나올 수 있다. 그 경우 **문서 수정이 우선**이며, 정말 가짜 예시만 ALLOWLIST에 넣는다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/verify-doc-npm-scripts.mjs package.json
git commit -m "chore(docs): verify npm run script names cited in markdown"
```

---

### Task 4: CI에 문서 기계 검증 추가

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: `lint-typecheck` job에 스텝 두 개 삽입**

`npm run type-check` 줄 **바로 아래**에 다음을 넣는다(순서 고정: 타입체크 후 문서 검증).

```yaml
      - name: Audit markdown relative links
        run: npm run docs:audit-links
      - name: Verify npm scripts cited in docs
        run: npm run docs:verify-npm-scripts
```

**실패 시 의미:**  
- `docs:audit-links`: 상대 경로 링크가 가리키는 파일·디렉터리가 없음 → 링크 또는 파일 이동 수정.  
- `docs:verify-npm-scripts`: 문서에 적힌 `npm run <스크립트명>` 중, 집계 범위에 없는 이름 → 문서 오타, 삭제된 스크립트, 또는 ALLOWLIST 필요.

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run markdown link audit and doc npm script check"
```

---

### Task 5: 문서 포털에서 워크플로 링크

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: 「운영·도구」표에 한 행 추가**

`docs/README.md`의 `### 운영·도구` 아래 표에서 **「마이그레이션 상태 점검」행 다음、「트러블슈팅」행 앞**에 한 행을 삽입한다. `docs/README.md`는 `docs/` 기준이므로 링크 목적지는 `operations/ko/doc-audit-workflow.md`이다. 표 형식은 바로 위 행「마이그레이션 상태 점검」과 동일하게 맞추고, 두 번째 열은 스크립트 인덱스 행과 같은 패턴으로 `doc-audit-workflow.md`에 상대 링크를 건다(이 계획 파일 본문에는 해당 마크다운 링크를 적지 않는다. `docs:audit-links`가 `plans/` 기준으로 경로를 해석해 실패하기 때문이다).

- [ ] **Step 2: 커밋**

```bash
git add docs/README.md
git commit -m "docs: link doc audit workflow from docs portal"
```

---

### Task 6: 문서 인용과 스크립트 정합 맞추기 (회귀 제거)

**Files:**
- Modify: (CI 실패 로그에 나열된) 해당 `.md` 파일들
- Modify: `scripts/verify-doc-npm-scripts.mjs` — `ALLOWLIST_NAMES` (오탐이 명백할 때만)

- [ ] **Step 1: CI 또는 로컬에서 스크립트 실행 후 목록 비우기**

```bash
npm run docs:audit-links
npm run docs:verify-npm-scripts
```

- [ ] **Step 2: 깨진 링크는 대상 경로 수정 또는 문서 링크 수정**

`audit-markdown-links` 출력의 `file` / `target`를 기준으로 한다.

- [ ] **Step 3: 알 수 없는 `npm run`은 문서를 실제 스크립트명으로 고친다**

예: 스크립트가 제거되었다면 문서에서 해당 절을 삭제하거나 대체 명령으로 바꾼다.

- [ ] **Step 4: `npm run lint`, `npm run type-check`, `npm run test` 통과 확인**

```bash
npm run lint
npm run type-check
npm run test
```

- [ ] **Step 5: 커밋 (한 PR에 묶거나 링크/스크립트별로 쪼갠다)**

```bash
git add -A
git status
git commit -m "docs: align markdown links and npm run citations with package scripts"
```

---

## 계획 자체 리뷰 (스펙 대응 표)

| 스펙 섹션 | 대응 Task |
|-----------|-----------|
| 3.1 범위 D, 예외 명시 | Task 2 체크리스트 + Task 3 ALLOWLIST |
| 3.2 SSOT / 생성물 | Task 1 graphify 절 + Task 2 생성물 절 |
| 5 워크플로 | Task 1 |
| 6 자동화(링크, npm 인용) | Task 3–4 (의미 동치 CI 비필수는 스펙 그대로 유지) |
| 7 순서·완료 기준 | Task 2 |
| 9 로컬 재현 | Task 1·4 실패 시 의미 문구 |
| 11 plans 작성 | 본 문서 |

**플레이스홀더 스캔:** 위 단계에 `TBD` 없음. `ALLOWLIST_NAMES`는 구현자가 실패 시만 채운다.

---

## 실행 위임 (에이전트용)

계획 저장 위치: `docs/superpowers/plans/2026-05-03-doc-sync-automation.md`

**실행 방식 선택:**

1. **Subagent-Driven (권장)** — Task마다 새 서브에이전트, 태스크 간 리뷰  
2. **Inline Execution** — 같은 세션에서 `executing-plans` 스킬로 체크포인트 배치 실행

원하는 번호를 지정하면 그 방식으로 Task 1부터 진행하면 된다.
