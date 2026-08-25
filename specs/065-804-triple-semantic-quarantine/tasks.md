# 자동 triple semantic 격리 — 작업 분해

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (권장) 또는
> `superpowers:executing-plans`로 이 계획을 작업 단위로 실행하십시오. 각 단계는 체크박스(`- [ ]`)로 추적합니다.

**Goal**: 라이브 DB의 파이프라인 산출 템플릿 문장 semantic(2026-08-23 실측 24,113건)을 기존 `forget`
도구로 격리하는 운영 러너를 만들고, dry-run → 사본 리허설 → 라이브 실행 → 검증 순서로 수행한다.

**Architecture**: `scripts/` 아래 단일 CLI 러너 + `scripts/lib/quarantine-*.ts` 4개 모듈. 삭제 로직은
재구현하지 않고 `@memento/core`의 공개 `executeTool('forget', …)`을 호출한다. 안전은 두 축으로 만든다 —
(1) 읽기 명령은 `readonly` 커넥션으로 열어 무변경을 **구조적으로** 보장하고, (2) 파괴적 명령은 12종
중단 게이트를 순서대로 통과해야만 첫 행을 지운다.

**Tech Stack**: TypeScript (ES modules), Node.js ≥24, `better-sqlite3`, `sqlite-vec`, Vitest,
`@memento/core` (`executeTool`)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Research**: [research.md](./research.md) | **Data model**: [data-model.md](./data-model.md) |
**Contract**: [contracts/runner-cli.md](./contracts/runner-cli.md) | **Quickstart**: [quickstart.md](./quickstart.md)

---

## Global Constraints

모든 작업의 요구사항에 아래가 암묵적으로 포함된다. 값은 spec에서 그대로 옮겼다.

- **런타임**: Node.js ≥ 24, npm ≥ 10, TypeScript ES modules (헌법 Additional Constraints)
- **`DB_PATH`는 절대 경로**여야 한다. `~`는 확장되지 않는다. 아니면 실행 거부 — 종료 코드 10 (FR-009)
- **`PRAGMA foreign_keys = ON`** 확인 없이는 파괴적 명령을 실행하지 않는다 — 종료 코드 11 (FR-006)
- **배치 상한 100**. `forget`의 `maxItems: 100`을 넘길 수 없다 (FR-005)
- **삭제는 `forget`만 수행**한다. 러너는 `DELETE FROM memory_item`을 직접 실행하지 않는다 (FR-005)
- **산출물은 `.local/quarantine-065/` 아래에만** 만들고 커밋하지 않는다 (FR-006b, SC-007b)
- **종료 코드**: `0` 성공, `1` 예기치 못한 오류, `10~21` 게이트 실패 (contracts/runner-cli.md)
- **판별식**(FR-001, FR-002i) — 문자열 위치 비교. `LIKE` 금지:
  ```sql
  type = 'semantic'
    AND subject IS NOT NULL AND subject <> ''
    AND pinned = FALSE
    AND substr(content, 1, length(trim(subject))) = trim(subject)
    AND substr(content, length(trim(subject)) + 2, 1) = ' '
  ```
- **본문 형태**(FR-002f·002g): (1) 위 위치 비교 통과 = 템플릿 → **격리**, (3) `content = subject‖' · '‖predicate‖' · '‖object` → 보존, (2) 나머지 = 원문 폴백 → 보존
- **`initializeDatabase()`를 쓰지 않는다.** 마이그레이션과 스키마 보정을 실행해 호출만으로 라이브에 쓴다 (research 확인 6)
- **`@memento/core`는 `dist/`로 해석된다.** 러너를 실행하기 전에 `npm run build -w @memento/core`가 선행되어야 한다. vitest는 `src/`로 alias하므로 **테스트만 통과하고 스크립트가 깨질 수 있다**
- **파일당 500줄** 이하 (`scripts/check-file-sizes.ts` 기준)
- **커밋 금지 대상**: 기억 본문이 담긴 어떤 파일도 커밋하지 않는다. 매 작업의 커밋 단계에서 `git status`로 확인

---

## Format: `[ID] [마커] [Story] 설명`

| 마커 | 뜻 |
|---|---|
| `[P]` | 다른 파일을 건드리므로 병렬 실행 가능 |
| `[TDD]` | RED-GREEN-REFACTOR 필수 — 실패하는 테스트를 먼저 쓴다 |
| `[REVIEW]` | 사람의 확인 후에만 다음으로 넘어간다 (운영 단계 게이트) |
| `[SUBAGENT]` | 별도 서브에이전트에 위임 가능 |

---

## 범위 결정 (명시)

spec의 Assumptions는 *"어디까지 실행할지는 plan·tasks에서 정할 구현 범위 문제"*라고 남겼다. 이 문서가 정한다.

- **코드 산출물**은 러너 5개 파일과 그 테스트 전부다 — `report`·`export-relations`·`rehearse`·
  `execute`·`cleanup`·`vacuum` 여섯 하위 명령을 모두 구현한다. 명령을 나눠 만들 이유가 없다.
- **라이브 실행 단계**(백업·프로브·리허설·격리·재기동)는 코드 작업이 아니라 **`[REVIEW]` 운영자 게이트**다.
  구현 완료가 곧 실행 승인이 아니며, 각 게이트는 사람이 판단해 통과시킨다.
- 브랜치 이름이 `dry-run`이지만 러너는 전 범위를 담는다. 실행 여부는 게이트가 통제한다.

---

## 파일 구조

| 파일 | 책임 | 예상 |
|---|---|---:|
| `scripts/quarantine-pipeline-semantic.ts` | CLI 파싱 · 하위 명령 분기 · `main` · 유일한 `process.exit` | ~160 |
| `scripts/lib/quarantine-gates.ts` | 경로 검증 · DB 열기 · FK 확인 · 게이트 12종 · `QuarantineGateError` | ~170 |
| `scripts/lib/quarantine-targets.ts` | 판별식 · 형태 분류 · 오탐 교차검증 · 표본 · 분포 · 대조 집계 | ~220 |
| `scripts/lib/quarantine-report.ts` | 산출물 경로 강제 · dry-run 리포트 조립 · `relations.jsonl` | ~200 |
| `scripts/lib/quarantine-run.ts` | `forget` 어댑터 · 반복/재개 · 잔재 정리 · `VACUUM` · 프로브 대조 | ~200 |

테스트는 각 파일 옆에 `*.spec.ts`로 둔다 (저장소 관례: `scripts/repair-triple-sentence-memories.spec.ts`).
vitest include가 `{tests,scripts,apps}/**/*.spec.ts`이므로 `scripts/lib/` 아래도 자동으로 잡힌다.

---

## Phase 1: Setup

**목적**: 산출물이 새어나가지 않게 막고, 러너를 실행 가능한 껍데기로 만든다.

### T001 [P] 산출물 경로를 `.gitignore`에 등록

**Files:** Modify: `.gitignore`

**근거**: 2026-08-23 확인 결과 `.gitignore`에는 `.local/longmemeval/`·`.local/locomo/`만 있고
`.local/` 전체는 무시되지 **않는다**. `git check-ignore .local/quarantine-065/dry-run-report.md`가
"NOT IGNORED"를 반환했다. 표본 A 50건에 기억 본문이 들어가므로 SC-007b가 이 한 줄에 걸려 있다.

- [x] **Step 1: 현재 상태를 확인해 재현한다**

```bash
git check-ignore -v .local/quarantine-065/dry-run-report.md; echo "exit=$?"
```
Expected: 출력 없음, `exit=1` (무시되지 않음)

- [x] **Step 2: `.local/longmemeval/` 줄 옆에 추가한다**

```gitignore
.local/longmemeval/
.local/locomo/
.local/quarantine-065/
```

- [x] **Step 3: 무시되는지 확인한다**

```bash
git check-ignore -v .local/quarantine-065/dry-run-report.md; echo "exit=$?"
```
Expected: `.gitignore:162:.local/quarantine-065/  .local/quarantine-065/dry-run-report.md`, `exit=0`

- [x] **Step 4: 커밋**

```bash
git add .gitignore
git commit -m "chore(065): ignore quarantine runner artifacts under .local/"
```

---

### T002 [TDD] CLI 진입점과 옵션 파싱

**Files:**
- Create: `scripts/quarantine-pipeline-semantic.ts`
- Create: `scripts/quarantine-pipeline-semantic.spec.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `parseOptions(argv: string[]): Options`, `type Command`, `const COMMANDS`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// scripts/quarantine-pipeline-semantic.spec.ts
import { describe, expect, it } from 'vitest';
import { parseOptions } from './quarantine-pipeline-semantic.js';

describe('parseOptions', () => {
  it('기본값을 계약대로 채운다', () => {
    expect(parseOptions(['report'])).toEqual({
      command: 'report',
      out: '.local/quarantine-065',
      batchSize: 100,
      sampleSize: 50,
      driftTolerance: 5,
      resume: false,
      yes: false,
    });
  });

  it('배치 상한 100을 넘기면 거부한다', () => {
    expect(() => parseOptions(['execute', '--batch-size', '200'])).toThrow(/100/);
  });

  it('알 수 없는 명령을 거부한다', () => {
    expect(() => parseOptions(['nuke'])).toThrow(/nuke/);
  });

  it('execute 에서는 --yes 를 무시한다', () => {
    expect(parseOptions(['execute', '--yes']).yes).toBe(false);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/quarantine-pipeline-semantic.spec.ts`
Expected: FAIL — `Failed to resolve import "./quarantine-pipeline-semantic.js"`

- [x] **Step 3: 최소 구현**

```ts
#!/usr/bin/env node
import { isMain } from './lib/cli.js';

export const COMMANDS = ['report', 'export-relations', 'rehearse', 'execute', 'cleanup', 'vacuum'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Options {
  command: Command;
  out: string;
  batchSize: number;
  sampleSize: number;
  driftTolerance: number;
  resume: boolean;
  yes: boolean;
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const raw = argv[i + 1];
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) throw new Error(`${name} 값이 숫자가 아닙니다: ${raw}`);
  return value;
}

export function parseOptions(argv: string[]): Options {
  const command = argv[0] as Command;
  if (!COMMANDS.includes(command)) {
    throw new Error(`알 수 없는 명령: ${argv[0] ?? '(없음)'} — ${COMMANDS.join(' | ')}`);
  }
  const batchSize = numberFlag(argv, '--batch-size', 100);
  if (batchSize < 1 || batchSize > 100) {
    throw new Error(`--batch-size 는 1~100 이어야 합니다 (forget maxItems 100): ${batchSize}`);
  }
  const outIndex = argv.indexOf('--out');
  return {
    command,
    out: outIndex === -1 ? '.local/quarantine-065' : (argv[outIndex + 1] ?? '.local/quarantine-065'),
    batchSize,
    sampleSize: numberFlag(argv, '--sample-size', 50),
    driftTolerance: numberFlag(argv, '--drift-tolerance', 5),
    resume: argv.includes('--resume'),
    // 계약: --yes 는 execute 에서 무시된다
    yes: command === 'execute' ? false : argv.includes('--yes'),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log(`[quarantine-065] ${options.command} (구현 예정)`);
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/quarantine-pipeline-semantic.spec.ts`
Expected: PASS (4 tests)

- [x] **Step 5: npm script를 등록한다**

`package.json`의 `"forgetting:events"` 아래에 추가:

```json
"memory:quarantine-065": "npm run build -w @memento/core && tsx scripts/quarantine-pipeline-semantic.ts",
```

빌드를 앞에 두는 이유: `@memento/core`가 `dist/`로 해석되므로 (`mcp:tool-surface`와 같은 선례).

- [x] **Step 6: 커밋**

```bash
git add scripts/quarantine-pipeline-semantic.ts scripts/quarantine-pipeline-semantic.spec.ts package.json
git commit -m "feat(065): add quarantine runner CLI entrypoint and option parsing"
```

**Checkpoint**: `npm run memory:quarantine-065 -- report`가 오류 없이 한 줄을 출력한다.

---

## Phase 2: Foundational (차단 선행 조건)

**⚠️ 이 단계가 끝나기 전에는 어떤 User Story 작업도 시작할 수 없다.** 여기서 만드는 것이
"라이브를 건드리지 않는다"는 보장 자체이기 때문이다.

### T003 [TDD] DB 열기 규율 — 읽기 전용과 FK 확인

**Files:**
- Create: `scripts/lib/quarantine-gates.ts`
- Create: `scripts/lib/quarantine-gates.spec.ts`

**Interfaces:**
- Consumes: `openDb`, `CliDatabase` (`scripts/lib/cli.ts`)
- Produces: `QuarantineGateError`, `assertAbsoluteDbPath(p?: string): string`,
  `openReadonly(p: string): CliDatabase`, `openForWrite(p: string): CliDatabase`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// scripts/lib/quarantine-gates.spec.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { assertAbsoluteDbPath, openForWrite, openReadonly, QuarantineGateError } from './quarantine-gates.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'q065-'));
  dbPath = join(dir, 'memory.db');
  const seed = new Database(dbPath);
  seed.exec("CREATE TABLE memory_item (id TEXT PRIMARY KEY, type TEXT NOT NULL)");
  seed.exec("INSERT INTO memory_item VALUES ('mem_a', 'semantic')");
  seed.close();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('assertAbsoluteDbPath', () => {
  it('상대 경로를 종료 코드 10으로 거부한다', () => {
    expect(() => assertAbsoluteDbPath('./data/memory.db')).toThrow(QuarantineGateError);
    try {
      assertAbsoluteDbPath('./data/memory.db');
    } catch (error) {
      expect((error as QuarantineGateError).code).toBe(10);
    }
  });

  it('~ 를 포함한 경로를 거부한다 (셸이 확장하지 않은 경우)', () => {
    expect(() => assertAbsoluteDbPath('~/.memento/data/memory.db')).toThrow(QuarantineGateError);
  });

  it('미설정을 거부한다', () => {
    expect(() => assertAbsoluteDbPath(undefined)).toThrow(QuarantineGateError);
  });

  it('절대 경로는 그대로 돌려준다', () => {
    expect(assertAbsoluteDbPath('/abs/memory.db')).toBe('/abs/memory.db');
  });
});

describe('openReadonly', () => {
  it('쓰기를 거부한다', () => {
    const db = openReadonly(dbPath);
    expect(() => db.exec("INSERT INTO memory_item VALUES ('mem_b', 'semantic')")).toThrow();
    db.close();
  });
});

describe('openForWrite', () => {
  it('foreign_keys 를 켜고 되읽어 확인한다', () => {
    const db = openForWrite(dbPath);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-gates.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [x] **Step 3: 최소 구현**

```ts
// scripts/lib/quarantine-gates.ts
import { isAbsolute } from 'node:path';
import { openDb, type CliDatabase } from './cli.js';

/** 계약의 종료 코드 10~21을 그대로 나른다. main() 만이 이 코드로 process.exit 한다. */
export class QuarantineGateError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'QuarantineGateError';
  }
}

/** FR-009: 절대 경로가 아니면 엉뚱한 DB를 지울 수 있다. ~ 는 셸이 확장하지 않으면 그대로 온다. */
export function assertAbsoluteDbPath(dbPath: string | undefined): string {
  if (!dbPath || !isAbsolute(dbPath) || dbPath.includes('~')) {
    throw new QuarantineGateError(10, `DB_PATH 는 절대 경로여야 합니다: ${dbPath ?? '(미설정)'}`);
  }
  return dbPath;
}

/**
 * SC-004: 읽기 명령의 무변경을 약속이 아니라 구조로 만든다.
 * initializeDatabase() 는 마이그레이션을 돌리므로 절대 쓰지 않는다 (research 확인 6).
 */
export function openReadonly(dbPath: string): CliDatabase {
  return openDb(dbPath, { readonly: true });
}

/** FR-006: better-sqlite3 는 FK를 기본 OFF로 연다. 켜지지 않으면 연쇄 정리가 통째로 실패한다. */
export function openForWrite(dbPath: string): CliDatabase {
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    db.close();
    throw new QuarantineGateError(11, 'PRAGMA foreign_keys 를 켤 수 없습니다 — 연쇄 정리가 불가능합니다');
  }
  return db;
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-gates.spec.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-gates.ts scripts/lib/quarantine-gates.spec.ts
git commit -m "feat(065): add DB open discipline with readonly and foreign-key verification"
```

---

### T004 [TDD] 게이트 프레임워크 — 순서 평가와 종료 코드

**Files:**
- Modify: `scripts/lib/quarantine-gates.ts`
- Modify: `scripts/lib/quarantine-gates.spec.ts`

**Interfaces:**
- Produces: `interface Gate { id: number; name: string; code: number; check: () => true | string }`,
  `runGates(gates: Gate[]): { code: number; reason: string } | null`

게이트가 `process.exit`을 호출하지 않고 **값을 반환**하는 것이 핵심이다. 그래야 종료 코드 10~21을
단위 테스트할 수 있다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
// scripts/lib/quarantine-gates.spec.ts 에 추가
import { runGates, type Gate } from './quarantine-gates.js';

describe('runGates', () => {
  const pass = (id: number, code: number): Gate => ({ id, name: `게이트 ${id}`, code, check: () => true });

  it('전부 통과하면 null 을 반환한다', () => {
    expect(runGates([pass(1, 10), pass(2, 11)])).toBeNull();
  });

  it('첫 실패에서 멈추고 그 뒤 게이트를 평가하지 않는다', () => {
    let laterCalled = false;
    const gates: Gate[] = [
      pass(1, 10),
      { id: 2, name: '백업 크기 대조', code: 14, check: () => '사본 A 가 라이브의 3% 크기입니다' },
      { id: 3, name: '뒤 게이트', code: 15, check: () => { laterCalled = true; return true; } },
    ];

    expect(runGates(gates)).toEqual({ code: 14, reason: '사본 A 가 라이브의 3% 크기입니다' });
    expect(laterCalled).toBe(false);
  });

  it('사유를 주지 않으면 게이트 이름으로 사유를 만든다', () => {
    const gates: Gate[] = [{ id: 9, name: 'kg_triple 보존율', code: 18, check: () => '' }];
    expect(runGates(gates)?.reason).toContain('kg_triple 보존율');
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-gates.spec.ts -t runGates`
Expected: FAIL — `runGates is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-gates.ts` 에 추가)**

```ts
export interface Gate {
  /** 계약 문서의 게이트 번호 (1~12) */
  id: number;
  name: string;
  /** 실패 시 종료 코드 (10~21) */
  code: number;
  /** 통과면 true, 실패면 사유 문자열 */
  check: () => true | string;
}

export interface GateFailure {
  code: number;
  reason: string;
}

/** 계약: 순서대로 평가하고 하나라도 실패하면 삭제를 0건 수행한 채 비영점 코드로 종료한다. */
export function runGates(gates: Gate[]): GateFailure | null {
  for (const gate of gates) {
    const outcome = gate.check();
    if (outcome !== true) {
      return { code: gate.code, reason: outcome || `게이트 ${gate.id} 실패: ${gate.name}` };
    }
  }
  return null;
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-gates.spec.ts`
Expected: PASS (9 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-gates.ts scripts/lib/quarantine-gates.spec.ts
git commit -m "feat(065): add ordered abort-gate framework returning exit codes"
```

---

### T005 [TDD] 산출물 경로 강제와 JSONL 기록

**Files:**
- Create: `scripts/lib/quarantine-report.ts`
- Create: `scripts/lib/quarantine-report.spec.ts`

**Interfaces:**
- Consumes: `QuarantineGateError` (`quarantine-gates.ts`)
- Produces: `resolveOutDir(out: string, repoRoot: string): string`,
  `appendJsonl(file: string, row: unknown): void`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// scripts/lib/quarantine-report.spec.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, resolveOutDir } from './quarantine-report.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'q065-out-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveOutDir', () => {
  it('저장소 안이면 .local/ 아래만 허용한다', () => {
    expect(() => resolveOutDir('specs/065/report', '/repo')).toThrow(/\.local/);
  });

  it('저장소 안 .local/ 아래는 허용한다', () => {
    expect(resolveOutDir('/repo/.local/quarantine-065', '/repo')).toBe('/repo/.local/quarantine-065');
  });

  it('저장소 밖은 그대로 허용한다', () => {
    expect(resolveOutDir('/tmp/q065', '/repo')).toBe('/tmp/q065');
  });
});

describe('appendJsonl', () => {
  it('한 줄에 한 레코드씩 덧붙인다', () => {
    const file = join(dir, 'progress.jsonl');
    appendJsonl(file, { batch: 1, ok: ['mem_a'] });
    appendJsonl(file, { batch: 2, ok: ['mem_b'] });

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toEqual({ batch: 2, ok: ['mem_b'] });
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [x] **Step 3: 최소 구현**

```ts
// scripts/lib/quarantine-report.ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { QuarantineGateError } from './quarantine-gates.js';

/**
 * FR-006b: 표본 A 에 기억 본문이 들어가므로 저장소 안에 만들 경우 .local/ 아래여야 한다.
 * .gitignore 가 .md·.json 을 막지 않기 때문에 경로 자체로 막는다 (T001 과 이중 방어).
 */
export function resolveOutDir(out: string, repoRoot: string): string {
  const abs = resolve(repoRoot, out);
  const insideRepo = abs === repoRoot || abs.startsWith(repoRoot + sep);
  const insideLocal = abs.startsWith(join(repoRoot, '.local') + sep);
  if (insideRepo && !insideLocal) {
    throw new QuarantineGateError(1, `산출물은 저장소 안이면 .local/ 아래여야 합니다: ${abs}`);
  }
  return abs;
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts`
Expected: PASS (4 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-report.ts scripts/lib/quarantine-report.spec.ts
git commit -m "feat(065): enforce .local artifact paths and add jsonl writer"
```

**Checkpoint**: 기반 완료 — 이제 User Story 작업을 시작할 수 있다. 읽기 명령이 라이브를 못 바꾸고,
게이트가 종료 코드를 값으로 돌려주며, 산출물이 저장소 밖 또는 `.local/` 안에만 생긴다.

---

## Phase 3: User Story 1 — 파괴 전에 격리 대상을 확인한다 (P1) 🎯 MVP

**Goal**: 어떤 행도 지우지 않고 "무엇을 지우게 되는가"에 답하는 dry-run 리포트를 만든다.

**Independent Test**: `report`를 라이브에 두 번 돌려도 `SELECT COUNT(*) FROM memory_item`이 바뀌지
않고, 리포트의 대상 건수가 24,113±5% 안이며 표본 A 50건이 전부 형태 (1)이다.

**공통 테스트 픽스처** — 이 Phase의 모든 spec 파일이 이 헬퍼를 각자 정의한다(파일 간 의존 없음).

```ts
// 각 *.spec.ts 상단에 둔다
import Database from 'better-sqlite3';

export function createFixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      importance REAL,
      pinned BOOLEAN DEFAULT FALSE,
      project_id TEXT,
      owner_id TEXT,
      privacy_scope TEXT DEFAULT 'private',
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      recall_count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE kg_triple (
      id INTEGER PRIMARY KEY,
      subject TEXT, predicate TEXT, object TEXT,
      representative_memory_id TEXT REFERENCES memory_item(id) ON DELETE SET NULL
    );
  `);
  return db;
}

export function insertMemory(db: Database.Database, row: Partial<{
  id: string; type: string; content: string; subject: string | null;
  predicate: string | null; object: string | null; importance: number;
  pinned: number; created_at: string;
}>): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, importance, pinned, created_at)
    VALUES (@id, @type, @content, @subject, @predicate, @object, @importance, @pinned, @created_at)
  `).run({
    id: row.id ?? 'mem_x', type: row.type ?? 'semantic', content: row.content ?? '',
    subject: row.subject ?? null, predicate: row.predicate ?? null, object: row.object ?? null,
    importance: row.importance ?? 0.5, pinned: row.pinned ?? 0,
    created_at: row.created_at ?? '2026-08-01T00:00:00Z',
  });
}
```

---

### T006 [TDD] 판별식 — 대상 집합

**Files:**
- Create: `scripts/lib/quarantine-targets.ts`
- Create: `scripts/lib/quarantine-targets.spec.ts`

**Interfaces:**
- Produces: `const TARGET_WHERE: string`, `countTargets(db): number`, `listTargetIds(db, limit?): string[]`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// scripts/lib/quarantine-targets.spec.ts
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countTargets, listTargetIds } from './quarantine-targets.js';
// createFixtureDb / insertMemory 는 위 픽스처를 이 파일 상단에 복사해 둔다

let db: Database.Database;
beforeEach(() => { db = createFixtureDb(); });
afterEach(() => db.close());

describe('격리 대상 판별식 (FR-001, FR-002i)', () => {
  it('subject + 조사 1글자 + 공백으로 시작하는 템플릿을 잡는다', () => {
    insertMemory(db, {
      id: 'mem_t1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(1);
    expect(listTargetIds(db)).toEqual(['mem_t1']);
  });

  it('subject 가 비면 잡지 않는다', () => {
    insertMemory(db, { id: 'mem_n1', subject: '', content: '사람이 직접 쓴 서술입니다' });
    insertMemory(db, { id: 'mem_n2', subject: null, content: '사람이 직접 쓴 서술입니다' });
    expect(countTargets(db)).toBe(0);
  });

  it('pinned 는 제외한다 (FR-001a)', () => {
    insertMemory(db, {
      id: 'mem_p1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1,
    });
    expect(countTargets(db)).toBe(0);
  });

  it('semantic 이 아니면 잡지 않는다', () => {
    insertMemory(db, {
      id: 'mem_e1', type: 'episodic', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });

  it('subject 의 _ 를 와일드카드로 해석하지 않는다 (LIKE 금지의 이유)', () => {
    // subject 'a_c' 가 LIKE 패턴이면 'abc는 …' 를 잘못 매칭한다. 위치 비교는 매칭하지 않는다.
    insertMemory(db, {
      id: 'mem_w1', subject: 'a_c', predicate: '호출', object: 'x',
      content: 'abc는 x를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });

  it('subject 로 시작해도 조사 자리 다음이 공백이 아니면 잡지 않는다', () => {
    insertMemory(db, {
      id: 'mem_x1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [x] **Step 3: 최소 구현**

```ts
// scripts/lib/quarantine-targets.ts
import type { CliDatabase } from './cli.js';

/**
 * FR-001 + FR-002i. LIKE 를 쓰지 않는다 — subject 값이 패턴에 그대로 삽입되면
 * 그 안의 _ · % 가 와일드카드로 해석된다 (실측상 _ 포함 subject 941건).
 * +2 가 공백 자리인 근거: attachParticle 이 조사를 정확히 1글자 붙인다.
 */
export const TARGET_WHERE = `
  type = 'semantic'
  AND subject IS NOT NULL AND subject <> ''
  AND pinned = FALSE
  AND substr(content, 1, length(trim(subject))) = trim(subject)
  AND substr(content, length(trim(subject)) + 2, 1) = ' '
`;

export function countTargets(db: CliDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM memory_item WHERE ${TARGET_WHERE}`).get() as { n: number };
  return row.n;
}

/** ORDER BY id 로 결정적 순서를 준다. 재개 시 같은 배치 경계를 재현하기 위함이다. */
export function listTargetIds(db: CliDatabase, limit?: number): string[] {
  const sql = `SELECT id FROM memory_item WHERE ${TARGET_WHERE} ORDER BY id${limit === undefined ? '' : ' LIMIT ?'}`;
  const rows = (limit === undefined ? db.prepare(sql).all() : db.prepare(sql).all(limit)) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 라이브에서 건수를 대조한다 (읽기 전용)**

```bash
sqlite3 "file:$HOME/.memento/data/memory.db?mode=ro" \
  "SELECT COUNT(*) FROM memory_item WHERE type='semantic' AND subject IS NOT NULL AND subject <> '' AND pinned = FALSE AND substr(content,1,length(trim(subject)))=trim(subject) AND substr(content,length(trim(subject))+2,1)=' ';"
```
Expected: 24,113 ± 5% (2026-08-23 실측 24,113. 2026-08-22 대비 +27건 = +0.11%)

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-targets.ts scripts/lib/quarantine-targets.spec.ts
git commit -m "feat(065): add positional-comparison target predicate for pipeline triple semantics"
```

---

### T007 [TDD] [P] 본문 형태 (1)(2)(3) 전수 분류

**Files:**
- Modify: `scripts/lib/quarantine-targets.ts`
- Modify: `scripts/lib/quarantine-targets.spec.ts`

**Interfaces:**
- Produces: `interface FormCounts { total: number; one: number; two: number; three: number }`,
  `classifyForms(db): FormCounts`, `listPreservedFormIds(db): string[]`

**모수 주의**: 형태 분류의 모수는 격리 대상이 아니라 **`subject`를 가진 semantic 전체**다(FR-002g).
제외분까지 넣어야 제외 규모를 알 수 있다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('본문 형태 분류 (FR-002f, FR-002g)', () => {
  it('세 형태를 각각 센다', () => {
    insertMemory(db, { id: 'mem_f1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });                              // 형태 (1)
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'pragma()', object: 'forget',
      content: '어제 회의에서 러너 실행 순서를 다시 정리했다' });              // 형태 (2)
    insertMemory(db, { id: 'mem_f3', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너 · 호출 · forget' });                                    // 형태 (3)

    expect(classifyForms(db)).toEqual({ total: 3, one: 1, two: 1, three: 1 });
  });

  it('pinned 도 모수에 넣는다 (제외 규모를 알기 위함)', () => {
    insertMemory(db, { id: 'mem_f4', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1 });
    expect(classifyForms(db).one).toBe(1);
    expect(countTargets(db)).toBe(0);
  });

  it('보존되는 형태 (2)(3) 의 ID 를 남긴다 (SC-003c)', () => {
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'x', object: 'y',
      content: '사람이 쓴 원문이 그대로 들어온 경우' });
    insertMemory(db, { id: 'mem_f3', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너 · 호출 · forget' });
    expect(listPreservedFormIds(db).sort()).toEqual(['mem_f2', 'mem_f3']);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts -t 형태`
Expected: FAIL — `classifyForms is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-targets.ts` 에 추가)**

```ts
/** 형태 분류의 모수: subject 를 가진 semantic 전체 (pinned 포함) */
const FORM_UNIVERSE = `type = 'semantic' AND subject IS NOT NULL AND subject <> ''`;

const FORM_ONE_EXPR = `
  substr(content, 1, length(trim(subject))) = trim(subject)
  AND substr(content, length(trim(subject)) + 2, 1) = ' '
`;

/** 형태 (3) 도 LIKE 가 아니라 등호 비교를 쓴다 (FR-002i) */
const FORM_THREE_EXPR = `content = trim(subject) || ' · ' || trim(predicate) || ' · ' || trim(object)`;

export interface FormCounts {
  total: number;
  one: number;
  two: number;
  three: number;
}

export function classifyForms(db: CliDatabase): FormCounts {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${FORM_ONE_EXPR} THEN 1 ELSE 0 END) AS one,
      SUM(CASE WHEN ${FORM_THREE_EXPR} THEN 1 ELSE 0 END) AS three
    FROM memory_item
    WHERE ${FORM_UNIVERSE}
  `).get() as { total: number; one: number | null; three: number | null };

  const one = row.one ?? 0;
  const three = row.three ?? 0;
  return { total: row.total, one, three, two: row.total - one - three };
}

/** FR-001b·SC-003c: 격리에서 제외되는 형태 (2)(3) 의 ID 목록 */
export function listPreservedFormIds(db: CliDatabase): string[] {
  const rows = db.prepare(`
    SELECT id FROM memory_item
    WHERE ${FORM_UNIVERSE} AND NOT (${FORM_ONE_EXPR})
    ORDER BY id
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: PASS (9 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-targets.ts scripts/lib/quarantine-targets.spec.ts
git commit -m "feat(065): classify semantic content into template, fallback and join forms"
```

---

### T008 [TDD] 오탐 전수 검증 — 두 방식 교차 집계

**Files:**
- Modify: `scripts/lib/quarantine-targets.ts`
- Modify: `scripts/lib/quarantine-targets.spec.ts`

**Interfaces:**
- Produces: `interface FalsePositiveCheck { positional: number; escapedLike: number; emptySubject: number; agree: boolean }`,
  `crossVerifyTargets(db): FalsePositiveCheck`

표본 50건은 오탐률 6% 미만만 보장하므로 판정 근거가 될 수 없다(FR-002j). 전수로 센다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('오탐 전수 검증 (FR-002j, SC-003)', () => {
  it('두 방식이 일치하면 agree 가 true 다', () => {
    insertMemory(db, { id: 'mem_c1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    expect(crossVerifyTargets(db)).toEqual({
      positional: 1, escapedLike: 1, emptySubject: 0, agree: true,
    });
  });

  it('subject 안의 _ 를 이스케이프해 위치 비교와 같은 답을 낸다', () => {
    // 이스케이프하지 않은 LIKE 라면 이 행을 잘못 매칭해 두 값이 갈린다
    insertMemory(db, { id: 'mem_c2', subject: 'a_c', predicate: '호출', object: 'x',
      content: 'abc는 x를 호출합니다' });

    const result = crossVerifyTargets(db);
    expect(result.positional).toBe(0);
    expect(result.escapedLike).toBe(0);
    expect(result.agree).toBe(true);
  });

  it('subject 안의 % 도 이스케이프한다', () => {
    insertMemory(db, { id: 'mem_c3', subject: '50%', predicate: '초과', object: '임계',
      content: '50%는 임계를 초과합니다' });

    const result = crossVerifyTargets(db);
    expect(result.positional).toBe(1);
    expect(result.escapedLike).toBe(1);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts -t 오탐`
Expected: FAIL — `crossVerifyTargets is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-targets.ts` 에 추가)**

```ts
export interface FalsePositiveCheck {
  /** FR-002i 위치 비교 */
  positional: number;
  /** _ · % · \ 를 이스케이프한 LIKE — 독립 제2 방식 */
  escapedLike: number;
  /** 대상 중 subject 가 빈 행 (구조적으로 0이어야 한다) */
  emptySubject: number;
  agree: boolean;
}

export function crossVerifyTargets(db: CliDatabase): FalsePositiveCheck {
  const positional = countTargets(db);

  // TS 소스의 '\\' 는 SQL 문자열 안에서 백슬래시 1개다. 백슬래시를 먼저 이스케이프해야 한다.
  const escapedLikeRow = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_item
    WHERE type = 'semantic'
      AND subject IS NOT NULL AND subject <> ''
      AND pinned = FALSE
      AND content LIKE
        replace(replace(replace(trim(subject), '\\', '\\\\'), '_', '\\_'), '%', '\\%') || '_ %'
        ESCAPE '\\'
  `).get() as { n: number };

  const emptySubjectRow = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_item
    WHERE (${TARGET_WHERE}) AND (subject IS NULL OR trim(subject) = '')
  `).get() as { n: number };

  return {
    positional,
    escapedLike: escapedLikeRow.n,
    emptySubject: emptySubjectRow.n,
    agree: positional === escapedLikeRow.n && emptySubjectRow.n === 0,
  };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: PASS (12 tests)

- [x] **Step 5: 라이브에서 두 방식이 일치하는지 확인한다 (읽기 전용)**

```bash
sqlite3 "file:$HOME/.memento/data/memory.db?mode=ro" "
SELECT 'positional', COUNT(*) FROM memory_item
 WHERE type='semantic' AND subject IS NOT NULL AND subject <> '' AND pinned = FALSE
   AND substr(content,1,length(trim(subject)))=trim(subject)
   AND substr(content,length(trim(subject))+2,1)=' ';
SELECT 'escaped_like', COUNT(*) FROM memory_item
 WHERE type='semantic' AND subject IS NOT NULL AND subject <> '' AND pinned = FALSE
   AND content LIKE replace(replace(replace(trim(subject),'\','\\'),'_','\_'),'%','\%') || '_ %' ESCAPE '\';"
```
Expected: 두 값이 같다. 갈리면 오분류가 존재하므로 **실행하지 않는다**.

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-targets.ts scripts/lib/quarantine-targets.spec.ts
git commit -m "feat(065): cross-verify target set with escaped LIKE to detect misclassification"
```

---

### T009 [TDD] [P] 표본 A와 분포 집계

**Files:**
- Modify: `scripts/lib/quarantine-targets.ts`
- Modify: `scripts/lib/quarantine-targets.spec.ts`

**Interfaces:**
- Produces: `sampleTargets(db, size): SampleRow[]`, `importanceBuckets(db): Bucket[]`,
  `attributionCounts(db): Attribution`, `pinnedCandidates(db): string[]`,
  `fallbackTrendByMonth(db): Array<{ month: string; total: number; fallback: number; rate: number }>`

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('표본과 분포 (FR-002d, FR-003, FR-001c, FR-001d)', () => {
  it('표본은 ORDER BY random() 으로 뽑고 요청 크기를 넘지 않는다', () => {
    for (let i = 0; i < 5; i += 1) {
      insertMemory(db, { id: `mem_s${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const sample = sampleTargets(db, 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample.map((row) => row.id)).size).toBe(3);
  });

  it('모수가 표본 크기보다 작으면 전수를 준다', () => {
    insertMemory(db, { id: 'mem_s1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    expect(sampleTargets(db, 50)).toHaveLength(1);
  });

  it('importance 구간별로 센다', () => {
    insertMemory(db, { id: 'mem_i1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', importance: 0.9 });
    insertMemory(db, { id: 'mem_i2', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', importance: 0.3 });

    const buckets = importanceBuckets(db);
    expect(buckets.find((b) => b.bucket === '0.8~1.0')?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === '0.2~0.4')?.count).toBe(1);
  });

  it('귀속이 전부 NULL 이면 그렇게 보고한다 (FR-001d)', () => {
    insertMemory(db, { id: 'mem_a1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    expect(attributionCounts(db)).toEqual({
      withProject: 0, withOwner: 0, nonPrivate: 0, softDeleted: 0, total: 1,
    });
  });

  it('pinned 후보를 별도 목록으로 남긴다 (FR-001a)', () => {
    insertMemory(db, { id: 'mem_pin', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1 });
    expect(pinnedCandidates(db)).toEqual(['mem_pin']);
  });

  it('형태 (2) 의 월별 추이를 낸다 (FR-001c)', () => {
    insertMemory(db, { id: 'mem_m1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', created_at: '2026-07-02T00:00:00Z' });
    insertMemory(db, { id: 'mem_m2', subject: '러너', predicate: 'pragma()', object: 'forget',
      content: '사람이 쓴 원문 그대로', created_at: '2026-08-02T00:00:00Z' });

    const trend = fallbackTrendByMonth(db);
    expect(trend).toEqual([
      { month: '2026-07', total: 1, fallback: 0, rate: 0 },
      { month: '2026-08', total: 1, fallback: 1, rate: 1 },
    ]);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts -t 표본`
Expected: FAIL — `sampleTargets is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-targets.ts` 에 추가)**

```ts
export interface SampleRow {
  id: string;
  subject: string;
  content: string;
  importance: number | null;
}

/**
 * FR-002d: ORDER BY id LIMIT n OFFSET <random> 은 연속 블록을 뽑아 같은 세션의 행만 나온다.
 * 반드시 ORDER BY random() 을 쓴다.
 */
export function sampleTargets(db: CliDatabase, size: number): SampleRow[] {
  return db.prepare(`
    SELECT id, subject, content, importance
    FROM memory_item
    WHERE ${TARGET_WHERE}
    ORDER BY random()
    LIMIT ?
  `).all(size) as SampleRow[];
}

export interface Bucket { bucket: string; count: number }

export function importanceBuckets(db: CliDatabase): Bucket[] {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN importance IS NULL THEN 'NULL'
        WHEN importance >= 0.8 THEN '0.8~1.0'
        WHEN importance >= 0.6 THEN '0.6~0.8'
        WHEN importance >= 0.4 THEN '0.4~0.6'
        WHEN importance >= 0.2 THEN '0.2~0.4'
        ELSE '0.0~0.2'
      END AS bucket,
      COUNT(*) AS count
    FROM memory_item
    WHERE ${TARGET_WHERE}
    GROUP BY bucket
    ORDER BY bucket
  `).all() as Bucket[];
  return rows;
}

export interface Attribution {
  total: number;
  withProject: number;
  withOwner: number;
  nonPrivate: number;
  softDeleted: number;
}

/** FR-001d: 값이 NULL 이 아닌 행이 나타나면 파이프라인이 귀속을 채우기 시작했다는 뜻이다. */
export function attributionCounts(db: CliDatabase): Attribution {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) AS withProject,
      SUM(CASE WHEN owner_id IS NOT NULL THEN 1 ELSE 0 END) AS withOwner,
      SUM(CASE WHEN privacy_scope IS NOT NULL AND privacy_scope <> 'private' THEN 1 ELSE 0 END) AS nonPrivate,
      SUM(CASE WHEN is_deleted THEN 1 ELSE 0 END) AS softDeleted
    FROM memory_item
    WHERE ${TARGET_WHERE}
  `).get() as Attribution;
}

/** FR-001a: 판별식에 걸릴 뻔했으나 pinned 라서 빠진 항목. forget 은 pinned 에서 예외를 던진다. */
export function pinnedCandidates(db: CliDatabase): string[] {
  const rows = db.prepare(`
    SELECT id FROM memory_item
    WHERE ${FORM_UNIVERSE} AND pinned = TRUE AND (${FORM_ONE_EXPR})
    ORDER BY id
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export interface MonthlyFallback { month: string; total: number; fallback: number; rate: number }

/** FR-001c: 형태 (2) 비중이 커지면 FR-001b 의 제외 근거(무시 가능)가 무너진다. */
export function fallbackTrendByMonth(db: CliDatabase): MonthlyFallback[] {
  const rows = db.prepare(`
    SELECT
      substr(created_at, 1, 7) AS month,
      COUNT(*) AS total,
      SUM(CASE WHEN (${FORM_ONE_EXPR}) OR (${FORM_THREE_EXPR}) THEN 0 ELSE 1 END) AS fallback
    FROM memory_item
    WHERE ${FORM_UNIVERSE}
    GROUP BY month
    ORDER BY month
  `).all() as Array<{ month: string; total: number; fallback: number }>;

  return rows.map((row) => ({ ...row, rate: row.total === 0 ? 0 : row.fallback / row.total }));
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: PASS (18 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-targets.ts scripts/lib/quarantine-targets.spec.ts
git commit -m "feat(065): add random sample, importance buckets, attribution and fallback trend"
```

---

### T010 [TDD] 코퍼스 대조와 연쇄 영향 집계

**Files:**
- Modify: `scripts/lib/quarantine-targets.ts`
- Modify: `scripts/lib/quarantine-targets.spec.ts`

**Interfaces:**
- Produces: `kgPreservation(db): { total: number; missing: number; rate: number }`,
  `kgPredicateNormalization(db): { total: number; hangulEnding: number; withSpace: number; avgLength: number }`,
  `cascadeImpact(db): Array<{ table: string; rows: number }>`

`kg_triple` 보존율 100%가 격리의 **핵심 정당화 근거**다(FR-004 b). 100% 미만이면 삭제가 0건이다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('kg_triple 보존 대조 (FR-004 b, SC-004a)', () => {
  it('전량 보존되면 rate 가 1 이다', () => {
    insertMemory(db, { id: 'mem_k1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('러너','호출','forget')").run();

    expect(kgPreservation(db)).toEqual({ total: 1, missing: 0, rate: 1 });
  });

  it('보존되지 않은 조합을 missing 으로 센다', () => {
    insertMemory(db, { id: 'mem_k2', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    const result = kgPreservation(db);
    expect(result.missing).toBe(1);
    expect(result.rate).toBe(0);
  });

  it('predicate 정규화 지표를 낸다 (FR-004d, SC-004b)', () => {
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('a','호출','b')").run();
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('a','pragma(mode)','b')").run();

    const metrics = kgPredicateNormalization(db);
    expect(metrics.total).toBe(2);
    expect(metrics.hangulEnding).toBe(1);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts -t kg_triple`
Expected: FAIL — `kgPreservation is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-targets.ts` 에 추가)**

```ts
export interface KgPreservation { total: number; missing: number; rate: number }

/** FR-004 (b): 자연어 서술이 사라져도 구조화된 사실은 남는다 — 이 확인이 그것을 보장한다. */
export function kgPreservation(db: CliDatabase): KgPreservation {
  // 바깥 조건을 서브쿼리로 분리한다. TARGET_WHERE 의 컬럼을 EXISTS 안에 그대로 두면
  // subject/predicate/object 가 kg_triple 쪽으로 해석돼 조용히 틀린 답이 나온다.
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM kg_triple k
        WHERE k.subject = m.subject AND k.predicate = m.predicate AND k.object = m.object
      ) THEN 0 ELSE 1 END) AS missing
    FROM memory_item m
    WHERE m.id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
  `).get() as { total: number; missing: number | null };

  const missing = row.missing ?? 0;
  return { total: row.total, missing, rate: row.total === 0 ? 1 : (row.total - missing) / row.total };
}

/**
 * FR-004d: 보존되는 저장소가 어떤 상태였는지의 기준선.
 * 한글 종결 판정은 마지막 글자의 코드포인트가 완성형 한글 구간(가~힣)인지로 본다.
 */
export function kgPredicateNormalization(db: CliDatabase): {
  total: number; hangulEnding: number; withSpace: number; avgLength: number;
} {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN unicode(substr(predicate, length(predicate), 1)) BETWEEN 44032 AND 55203
               THEN 1 ELSE 0 END) AS hangulEnding,
      SUM(CASE WHEN predicate LIKE '% %' THEN 1 ELSE 0 END) AS withSpace,
      AVG(length(predicate)) AS avgLength
    FROM kg_triple
    WHERE predicate IS NOT NULL AND predicate <> ''
  `).get() as { total: number; hangulEnding: number | null; withSpace: number | null; avgLength: number | null };

  return {
    total: row.total,
    hangulEnding: row.hangulEnding ?? 0,
    withSpace: row.withSpace ?? 0,
    avgLength: row.avgLength ?? 0,
  };
}

/**
 * FR-006a·006e: 연쇄로 사라질 행과 NULL 이 될 참조를 미리 센다.
 * pragma_foreign_key_list 로 실제 스키마에서 읽으므로 스키마가 바뀌어도 따라간다.
 */
export function cascadeImpact(db: CliDatabase): Array<{ table: string; column: string; onDelete: string; rows: number }> {
  const refs = db.prepare(`
    SELECT m.name AS table_name, fk."from" AS column_name, fk.on_delete AS on_delete
    FROM sqlite_master m
    JOIN pragma_foreign_key_list(m.name) fk
    WHERE m.type = 'table' AND fk."table" = 'memory_item'
    ORDER BY m.name, fk."from"
  `).all() as Array<{ table_name: string; column_name: string; on_delete: string }>;

  return refs.map((ref) => {
    // 식별자는 스키마에서 읽은 값이므로 사용자 입력이 아니다.
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM "${ref.table_name}"
      WHERE "${ref.column_name}" IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
    `).get() as { n: number };
    return { table: ref.table_name, column: ref.column_name, onDelete: ref.on_delete, rows: row.n };
  });
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-targets.spec.ts`
Expected: PASS (21 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-targets.ts scripts/lib/quarantine-targets.spec.ts
git commit -m "feat(065): measure kg_triple preservation, predicate normalization and cascade impact"
```

---

### T011 [TDD] `report` — dry-run 리포트 조립

**Files:**
- Modify: `scripts/lib/quarantine-report.ts`
- Modify: `scripts/lib/quarantine-report.spec.ts`
- Modify: `scripts/quarantine-pipeline-semantic.ts`

**Interfaces:**
- Consumes: `quarantine-targets.ts` 전체, `resolveOutDir`
- Produces: `buildDryRunReport(db, options: { sampleSize: number }): string`

- [x] **Step 1: 실패하는 테스트를 추가한다**

`quarantine-report.spec.ts` 상단에 Phase 3 서두의 `createFixtureDb` / `insertMemory` 를 복사해 둔다.

```ts
import { buildDryRunReport } from './quarantine-report.js';

describe('buildDryRunReport (FR-003, SC-003b·003c)', () => {
  it('필수 절을 모두 담는다', () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_r1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('러너','호출','forget')").run();

    const report = buildDryRunReport(db, { sampleSize: 50 });

    for (const heading of [
      '## 대상 건수', '## 본문 형태 분포', '## 오탐 전수 검증', '## 표본 A',
      '## 귀속 분포', '## kg_triple 보존', '## 연쇄 영향', '## 형태 (2) 월별 추이',
      '## 격리 제외 pinned',
    ]) {
      expect(report).toContain(heading);
    }
    db.close();
  });

  it('recall_count 출발값 차이를 주석으로 남긴다 (FR-001f)', () => {
    const db = createFixtureDb();
    expect(buildDryRunReport(db, { sampleSize: 50 })).toContain('createSemanticMemory');
    db.close();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts -t buildDryRunReport`
Expected: FAIL — `buildDryRunReport is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-report.ts` 에 추가)**

```ts
import type { CliDatabase } from './cli.js';
import {
  attributionCounts, cascadeImpact, classifyForms, countTargets, crossVerifyTargets,
  fallbackTrendByMonth, importanceBuckets, kgPredicateNormalization, kgPreservation,
  listPreservedFormIds, pinnedCandidates, sampleTargets,
} from './quarantine-targets.js';

function table(header: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${header.join(' | ')} |`;
  const sep = `|${header.map(() => '---').join('|')}|`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function buildDryRunReport(db: CliDatabase, options: { sampleSize: number }): string {
  const forms = classifyForms(db);
  const cross = crossVerifyTargets(db);
  const kg = kgPreservation(db);
  const predicate = kgPredicateNormalization(db);
  const attribution = attributionCounts(db);
  const pinned = pinnedCandidates(db);
  const preserved = listPreservedFormIds(db);

  return [
    `# dry-run 리포트 — 자동 triple semantic 격리`,
    ``,
    `생성: ${new Date().toISOString()} · 이 파일은 기억 본문을 담는다. 커밋 금지 (FR-006b).`,
    ``,
    `## 대상 건수`,
    ``,
    `격리 대상 **${countTargets(db)}건**`,
    ``,
    `> \`recall_count\` 주의(FR-001f): \`remember\` 로 만든 기억은 1에서, \`createSemanticMemory\` 는`,
    `> 컬럼을 INSERT 에 넣지 않아 0에서 시작한다. 두 값을 직접 비교하면 착시가 생긴다.`,
    ``,
    `## 본문 형태 분포`,
    ``,
    table(['형태', '건수', '처리'], [
      ['(1) 템플릿', forms.one, '격리'],
      ['(2) 원문 폴백', forms.two, '보존'],
      ['(3) · 조인', forms.three, '보존'],
      ['모수(subject 보유 semantic)', forms.total, '—'],
    ]),
    ``,
    `보존되는 형태 (2)(3) ID ${preserved.length}건: ${preserved.join(', ') || '없음'}`,
    ``,
    `## 오탐 전수 검증`,
    ``,
    table(['방식', '건수'], [
      ['위치 비교 (FR-002i)', cross.positional],
      ['이스케이프 LIKE', cross.escapedLike],
      ['대상 중 subject 결여', cross.emptySubject],
    ]),
    ``,
    cross.agree ? `**일치 — 오탐 0건**` : `**불일치 — 실행하지 말 것**`,
    ``,
    `## 표본 A`,
    ``,
    sampleTargets(db, options.sampleSize)
      .map((row, i) => `${i + 1}. \`${row.id}\` (importance ${row.importance ?? 'NULL'})\n   - ${row.content}`)
      .join('\n') || '표본 없음',
    ``,
    `## 귀속 분포`,
    ``,
    table(['항목', '건수'], [
      ['project_id 지정', attribution.withProject],
      ['owner_id 지정', attribution.withOwner],
      ['privacy_scope ≠ private', attribution.nonPrivate],
      ['소프트 삭제 표시', attribution.softDeleted],
      ['합계', attribution.total],
    ]),
    ``,
    `## kg_triple 보존`,
    ``,
    `보존율 **${(kg.rate * 100).toFixed(2)}%** (${kg.total - kg.missing}/${kg.total}) · 미보존 ${kg.missing}건`,
    ``,
    `predicate 정규화: 한글 종결 ${predicate.hangulEnding}/${predicate.total} · `
      + `공백 포함 ${predicate.withSpace} · 평균 ${predicate.avgLength.toFixed(1)}자`,
    ``,
    `## 연쇄 영향`,
    ``,
    table(['테이블', '컬럼', 'ON DELETE', '행 수'],
      cascadeImpact(db).map((row) => [row.table, row.column, row.onDelete, row.rows])),
    ``,
    `## 형태 (2) 월별 추이`,
    ``,
    table(['월', '생성', '폴백', '폴백률'],
      fallbackTrendByMonth(db).map((row) => [row.month, row.total, row.fallback, `${(row.rate * 100).toFixed(1)}%`])),
    ``,
    `## 격리 제외 pinned`,
    ``,
    pinned.length === 0 ? '없음' : pinned.map((id) => `- \`${id}\``).join('\n'),
    ``,
  ].join('\n');
}
```

- [x] **Step 4: 진입점에 `report` 를 배선한다 (`quarantine-pipeline-semantic.ts`)**

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertAbsoluteDbPath, openReadonly, QuarantineGateError } from './lib/quarantine-gates.js';
import { buildDryRunReport, resolveOutDir } from './lib/quarantine-report.js';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dbPath = assertAbsoluteDbPath(process.env.DB_PATH);
  const outDir = resolveOutDir(options.out, process.cwd());
  mkdirSync(outDir, { recursive: true });

  if (options.command === 'report') {
    const db = openReadonly(dbPath);
    try {
      const file = join(outDir, 'dry-run-report.md');
      writeFileSync(file, buildDryRunReport(db, { sampleSize: options.sampleSize }), 'utf8');
      console.log(`[quarantine-065] 리포트: ${file}`);
    } finally {
      db.close();
    }
    return;
  }

  throw new Error(`아직 구현되지 않은 명령: ${options.command}`);
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    if (error instanceof QuarantineGateError) {
      console.error(`[중단] ${error.message}`);
      process.exit(error.code);
    }
    console.error(error);
    process.exit(1);
  });
}
```

- [x] **Step 5: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts scripts/quarantine-pipeline-semantic.spec.ts`
Expected: PASS

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-report.ts scripts/lib/quarantine-report.spec.ts scripts/quarantine-pipeline-semantic.ts
git commit -m "feat(065): assemble dry-run report and wire the report subcommand"
```

---

### T012 [TDD] [P] `export-relations` — 관계 그래프 내보내기

**Files:**
- Modify: `scripts/lib/quarantine-report.ts`
- Modify: `scripts/lib/quarantine-report.spec.ts`
- Modify: `scripts/quarantine-pipeline-semantic.ts`

**Interfaces:**
- Produces: `exportRelations(db, file: string): { rows: number; byType: Record<string, number> }`

`memory_relation` 54,742행(88%)이 CASCADE로 사라지고 반대쪽 끝은 **전부 생존 기억**이다.
`kg_triple`이 보존하지 않으므로 **이 내보내기가 유일한 복구 근거**다(FR-006i, FR-006l).

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('exportRelations (FR-006i, SC-005c)', () => {
  it('본문 없이 식별자만 한 줄씩 쓴다', () => {
    const db = createFixtureDb();
    db.exec(`
      CREATE TABLE memory_relation (
        source_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
        target_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
        relation_type TEXT
      )
    `);
    insertMemory(db, { id: 'mem_t', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_src', type: 'episodic', content: '사람이 쓴 원문' });
    db.prepare("INSERT INTO memory_relation VALUES ('mem_t','mem_src','extracted_from')").run();

    const file = join(dir, 'relations.jsonl');
    const summary = exportRelations(db, file);

    expect(summary).toEqual({ rows: 1, byType: { extracted_from: 1 } });
    const line = JSON.parse(readFileSync(file, 'utf8').trim());
    expect(line).toEqual({
      target_id: 'mem_t', relation_type: 'extracted_from', other_id: 'mem_src', other_type: 'episodic',
    });
    expect(readFileSync(file, 'utf8')).not.toContain('사람이 쓴 원문');
    db.close();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts -t exportRelations`
Expected: FAIL — `exportRelations is not a function`

- [x] **Step 3: 최소 구현**

```ts
import { writeFileSync } from 'node:fs';
import { TARGET_WHERE } from './quarantine-targets.js';

export function exportRelations(db: CliDatabase, file: string): { rows: number; byType: Record<string, number> } {
  // 대상이 source 인 관계와 target 인 관계를 모두 모으고, 반대쪽 끝의 타입을 함께 남긴다.
  const rows = db.prepare(`
    SELECT r.source_id AS target_id, r.relation_type, r.target_id AS other_id, o.type AS other_type
    FROM memory_relation r
    JOIN memory_item o ON o.id = r.target_id
    WHERE r.source_id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
    UNION ALL
    SELECT r.target_id AS target_id, r.relation_type, r.source_id AS other_id, o.type AS other_type
    FROM memory_relation r
    JOIN memory_item o ON o.id = r.source_id
    WHERE r.target_id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
  `).all() as Array<{ target_id: string; relation_type: string; other_id: string; other_type: string }>;

  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');

  const byType: Record<string, number> = {};
  for (const row of rows) {
    byType[row.relation_type] = (byType[row.relation_type] ?? 0) + 1;
  }
  return { rows: rows.length, byType };
}
```

- [x] **Step 4: 진입점에 배선한다**

```ts
  if (options.command === 'export-relations') {
    const db = openReadonly(dbPath);
    try {
      const file = join(outDir, 'relations.jsonl');
      const summary = exportRelations(db, file);
      console.log(`[quarantine-065] 관계 ${summary.rows}행 → ${file}`);
      console.log(JSON.stringify(summary.byType, null, 2));
    } finally {
      db.close();
    }
    return;
  }
```

- [x] **Step 5: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-report.spec.ts`
Expected: PASS

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-report.ts scripts/lib/quarantine-report.spec.ts scripts/quarantine-pipeline-semantic.ts
git commit -m "feat(065): export target memory relations before quarantine"
```

---

### T013 [REVIEW] 라이브 dry-run 실행과 운영자 표본 검토

**Files:** 없음 (운영 단계). 산출물은 `.local/quarantine-065/`.

- [x] **Step 1: 실행 전 행 수를 기록한다**

```bash
export DB_PATH="$HOME/.memento/data/memory.db"
sqlite3 "file:$DB_PATH?mode=ro" "SELECT type, COUNT(*) FROM memory_item GROUP BY type;" | tee /tmp/q065-before-counts.txt
```

- [x] **Step 2: dry-run 을 돌린다**

```bash
npm run memory:quarantine-065 -- report
npm run memory:quarantine-065 -- export-relations
```

- [x] **Step 3: 라이브가 변하지 않았음을 확인한다 (SC-004)**

```bash
sqlite3 "file:$DB_PATH?mode=ro" "SELECT type, COUNT(*) FROM memory_item GROUP BY type;" > /tmp/q065-after-counts.txt
diff /tmp/q065-before-counts.txt /tmp/q065-after-counts.txt && echo "무변경 확인"
```
Expected: `무변경 확인`

- [x] **Step 4: 리포트에서 다음을 사람이 확인한다**

  - 오탐 전수 검증이 **일치**인가 (아니면 중단)
  - `kg_triple` 보존율이 **100%** 인가 (아니면 중단 — SC-004a)
  - 표본 A 50건이 전부 템플릿 문장인가. 사람이 손으로 쓴 서술이 보이면 **중단**하고 형태 판별을 재검토한다 (FR-002h)
  - 형태 (2) 월별 추이 — 비중이 계속 커지면 FR-001b 의 제외 근거를 재검토한다
  - 귀속 분포에 NULL 아닌 값이 나타났는가 (FR-001d)

- [x] **Step 5: 검토했음을 기록한다 (SC-003e)**

```bash
cat >> .local/quarantine-065/dry-run-report.md <<'REVIEWEOF'

## 운영자 검토

- 검토자: (이름)
- 검토일: (YYYY-MM-DD)
- 표본 A 50건 전수 확인: (통과 / 중단)
- 판단: (실행 승인 / 보류 — 사유)
REVIEWEOF
```

- [x] **Step 6: 산출물이 커밋되지 않는지 확인한다 (SC-007b)**

```bash
git status --porcelain | grep -c 'quarantine-065' # 0 이어야 한다
```

**Checkpoint**: User Story 1 완료. 여기서 멈춰도 "무엇을 지우게 되는가"에 대한 답은 확보된다.

---

## Phase 4: User Story 2 — 백업과 롤백 경로를 갖춘 채 격리를 실행한다 (P2)

**Goal**: 12종 게이트를 통과했을 때만 `forget`으로 대상을 지우고, 중단되면 재개하며, 잔재를 정리하고
공간을 회수한다.

**Independent Test**: 사본 B에서 `rehearse`를 돌려 잔여 대상 0건 · CASCADE 잔재 0행이 되고,
중간에 죽여도 `--resume`으로 이어져 최종 잔여가 0건이다(SC-006a).

---

### T014 [TDD] `forget` 어댑터 — `executeTool` 호출과 결과 파싱

**Files:**
- Create: `scripts/lib/quarantine-run.ts`
- Create: `scripts/lib/quarantine-run.spec.ts`

**Interfaces:**
- Consumes: `executeTool` (`@memento/core`)
- Produces: `interface BatchOutcome { successful: string[]; failed: Array<{ id: string; error: string }>; total: number }`,
  `parseBatchResult(result): BatchOutcome`, `type ForgetFn = (ids: string[]) => Promise<BatchOutcome>`,
  `createForgetFn(db): ForgetFn`

**왜 `executeTool`인가**: `ForgetTool` 클래스는 `@memento/core`의 공개 export가 아니고 패키지
`exports` 맵에도 그 경로가 없다. `tsx`로 돌리면 `@memento/core`가 `dist/`로 해석돼 직접
인스턴스화가 런타임에 깨진다. `executeTool`은 레지스트리를 거쳐 같은 `ForgetTool`에 도달한다
(research 결정 1).

- [x] **Step 1: 실패하는 테스트를 쓴다**

이 파일의 헤더에 뒤 작업(T015~T017, T022)이 쓰는 픽스처와 임시 디렉터리를 함께 둔다.

```ts
// scripts/lib/quarantine-run.spec.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl } from './quarantine-report.js';
import { countTargets } from './quarantine-targets.js';
import { parseBatchResult } from './quarantine-run.js';

// Phase 3 서두의 createFixtureDb / insertMemory 를 이 파일에도 복사해 둔다 (파일 간 의존 없음).

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'q065-run-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseBatchResult', () => {
  it('ToolResult 의 JSON 본문에서 batch_result 를 꺼낸다', () => {
    const result = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          batch_result: { successful: ['mem_a', 'mem_b'], failed: [], total: 2 },
          message: '배치 삭제 완료: 2/2 성공',
          deleted_type: 'hard',
        }, null, 2),
      }],
    };

    expect(parseBatchResult(result)).toEqual({ successful: ['mem_a', 'mem_b'], failed: [], total: 2 });
  });

  it('실패 항목의 사유를 보존한다', () => {
    const result = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          batch_result: {
            successful: [],
            failed: [{ id: 'mem_pinned', error: '핀된 기억은 삭제할 수 없습니다' }],
            total: 1,
          },
        }),
      }],
    };

    expect(parseBatchResult(result).failed[0]).toEqual({
      id: 'mem_pinned', error: '핀된 기억은 삭제할 수 없습니다',
    });
  });

  it('batch_result 가 없으면 조용히 넘어가지 않는다', () => {
    const result = { content: [{ type: 'text' as const, text: JSON.stringify({ message: '단일 삭제' }) }] };
    expect(() => parseBatchResult(result)).toThrow(/batch_result/);
  });

  it('본문이 비면 실패한다', () => {
    expect(() => parseBatchResult({ content: [] })).toThrow();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [x] **Step 3: 최소 구현**

```ts
// scripts/lib/quarantine-run.ts
import { executeTool } from '@memento/core';
import type { CliDatabase } from './cli.js';

export interface BatchOutcome {
  successful: string[];
  failed: Array<{ id: string; error: string }>;
  total: number;
}

interface TextToolResult {
  content: Array<{ text: string }>;
}

/** forget 은 createSuccessResult 로 감싸므로 content[0].text 가 JSON 문자열이다 (base-tool.ts:46-55). */
export function parseBatchResult(result: TextToolResult): BatchOutcome {
  const [first] = result.content;
  if (!first) {
    throw new Error('forget 결과가 비어 있습니다');
  }
  const payload = JSON.parse(first.text) as { batch_result?: BatchOutcome };
  if (!payload.batch_result) {
    throw new Error(`forget 결과에 batch_result 가 없습니다: ${first.text.slice(0, 200)}`);
  }
  return payload.batch_result;
}

export type ForgetFn = (ids: string[]) => Promise<BatchOutcome>;

/**
 * ToolContext 는 db 와 services 가 필수지만 services 의 항목은 전부 optional 이다.
 * createToolContext 는 완전한 ServerServices 를 요구하므로 쓰지 않는다.
 */
export function createForgetFn(db: CliDatabase): ForgetFn {
  return async (ids) => {
    const result = await executeTool(
      'forget',
      { batch: ids, hard: true, confirm: true, reason: 'issue #804 파이프라인 템플릿 문장 격리' },
      { db, services: {} },
    );
    return parseBatchResult(result as TextToolResult);
  };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: PASS (4 tests)

- [x] **Step 5: 실제 도구가 붙는지 스모크로 확인한다**

```bash
npm run build -w @memento/core
node --import tsx -e "import('@memento/core').then((m) => console.log(typeof m.executeTool))"
```
Expected: `function`. `undefined` 면 빌드가 낡았거나 export 표면이 바뀐 것이므로 여기서 멈춘다.

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-run.ts scripts/lib/quarantine-run.spec.ts
git commit -m "feat(065): add forget adapter over executeTool with batch result parsing"
```

---

### T015 [TDD] 반복 실행과 재개 — 진행 기록

**Files:**
- Modify: `scripts/lib/quarantine-run.ts`
- Modify: `scripts/lib/quarantine-run.spec.ts`

**Interfaces:**
- Consumes: `listTargetIds` (`quarantine-targets.ts`), `appendJsonl` (`quarantine-report.ts`)
- Produces: `runQuarantine(args: { db; forget: ForgetFn; batchSize: number; onBatch: (row: ProgressRow) => void }): Promise<RunSummary>`,
  `interface ProgressRow { batch: number; at: string; ok: string[]; failed: Array<{ id: string; error: string }> }`,
  `interface RunSummary { batches: number; deleted: number; failed: string[] }`

**재개는 커서가 아니라 판별식 재평가로 한다**(FR-005b). 매 배치마다 대상을 다시 조회하므로,
이미 지워진 건은 자연히 빠진다. 영구 실패 ID는 건너뛰어 무한 루프를 막는다(핀된 항목 등).

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('runQuarantine (FR-005, FR-005b, SC-006a)', () => {
  it('배치 상한만큼 끊어 부르고 잔여가 0이 되면 멈춘다', async () => {
    const db = createFixtureDb();
    for (let i = 0; i < 5; i += 1) {
      insertMemory(db, { id: `mem_${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const calls: string[][] = [];
    const forget: ForgetFn = async (ids) => {
      calls.push(ids);
      db.prepare(`DELETE FROM memory_item WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      return { successful: ids, failed: [], total: ids.length };
    };

    const summary = await runQuarantine({ db, forget, batchSize: 2, onBatch: () => {} });

    expect(calls.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(summary).toEqual({ batches: 3, deleted: 5, failed: [] });
    db.close();
  });

  it('중단 후 재실행하면 남은 대상만 처리한다', async () => {
    const db = createFixtureDb();
    for (let i = 0; i < 4; i += 1) {
      insertMemory(db, { id: `mem_${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const forget: ForgetFn = async (ids) => {
      db.prepare(`DELETE FROM memory_item WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      return { successful: ids, failed: [], total: ids.length };
    };

    // 1회차: 2건만 처리하고 중단된 상황을 흉내낸다
    await forget(['mem_0', 'mem_1']);
    const summary = await runQuarantine({ db, forget, batchSize: 100, onBatch: () => {} });

    expect(summary.deleted).toBe(2);
    expect(countTargets(db)).toBe(0);
    db.close();
  });

  it('영구 실패 ID 를 건너뛰어 무한 루프를 막는다', async () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_stuck', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_ok', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    const forget: ForgetFn = async (ids) => {
      const ok = ids.filter((id) => id !== 'mem_stuck');
      if (ok.length > 0) {
        db.prepare(`DELETE FROM memory_item WHERE id IN (${ok.map(() => '?').join(',')})`).run(...ok);
      }
      return {
        successful: ok,
        failed: ids.filter((id) => id === 'mem_stuck').map((id) => ({ id, error: '핀된 기억' })),
        total: ids.length,
      };
    };

    const summary = await runQuarantine({ db, forget, batchSize: 100, onBatch: () => {} });

    expect(summary.deleted).toBe(1);
    expect(summary.failed).toEqual(['mem_stuck']);
    db.close();
  });

  it('배치마다 성공·실패 ID 를 진행 기록으로 넘긴다', async () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_a', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    const rows: ProgressRow[] = [];
    const forget: ForgetFn = async (ids) => {
      db.prepare('DELETE FROM memory_item WHERE id = ?').run(ids[0]);
      return { successful: ids, failed: [], total: ids.length };
    };

    await runQuarantine({ db, forget, batchSize: 100, onBatch: (row) => rows.push(row) });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toEqual(['mem_a']);
    expect(rows[0]!.batch).toBe(1);
    expect(typeof rows[0]!.at).toBe('string');
    db.close();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts -t runQuarantine`
Expected: FAIL — `runQuarantine is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-run.ts` 에 추가)**

```ts
import { listTargetIds } from './quarantine-targets.js';

export interface ProgressRow {
  batch: number;
  at: string;
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface RunSummary {
  batches: number;
  deleted: number;
  failed: string[];
}

export async function runQuarantine(args: {
  db: CliDatabase;
  forget: ForgetFn;
  batchSize: number;
  onBatch: (row: ProgressRow) => void;
}): Promise<RunSummary> {
  const stuck = new Set<string>();
  let batches = 0;
  let deleted = 0;

  for (;;) {
    // 재개는 커서가 아니라 판별식 재평가다 — 이미 지워진 건은 여기서 자연히 빠진다.
    const remaining = listTargetIds(args.db).filter((id) => !stuck.has(id));
    if (remaining.length === 0) {
      break;
    }
    const ids = remaining.slice(0, args.batchSize);
    batches += 1;

    const outcome = await args.forget(ids);
    deleted += outcome.successful.length;
    for (const failure of outcome.failed) {
      stuck.add(failure.id);
    }
    args.onBatch({ batch: batches, at: new Date().toISOString(), ok: outcome.successful, failed: outcome.failed });

    if (outcome.successful.length === 0 && outcome.failed.length === 0) {
      throw new Error(`배치 ${batches}: 성공도 실패도 없습니다 — 진행이 불가능해 중단합니다`);
    }
  }

  return { batches, deleted, failed: [...stuck] };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: PASS (8 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-run.ts scripts/lib/quarantine-run.spec.ts
git commit -m "feat(065): add resumable batch quarantine loop with progress records"
```

---

### T016 [TDD] 잔재 정리 — `event_outbox` 와 `memory_forgetting_event`

**Files:**
- Modify: `scripts/lib/quarantine-run.ts`
- Modify: `scripts/lib/quarantine-run.spec.ts`

**Interfaces:**
- Produces: `cleanupResidue(db, args: { startedAt: string; deletedIds: string[] }): { outbox: number; forgettingEvents: number }`,
  `readDeletedIds(progressFile: string): string[]`

**FR-006f 주의**: `memory_forgetting_event`는 **격리된 ID를 참조하는 행에만** 손댄다.
`WHERE memory_id NOT IN (SELECT id FROM memory_item)`으로 지우면 우리와 무관한 고아까지 지운다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('cleanupResidue (FR-006d, FR-006f, FR-009a)', () => {
  function createResidueDb(): Database.Database {
    const db = createFixtureDb();
    db.exec(`
      CREATE TABLE event_outbox (id INTEGER PRIMARY KEY, event_type TEXT, created_at TEXT);
      CREATE TABLE memory_forgetting_event (id INTEGER PRIMARY KEY, memory_id TEXT, action TEXT);
    `);
    return db;
  }

  it('이번 실행분 memory.forgotten 만 지운다 (SC-005a)', () => {
    const db = createResidueDb();
    db.prepare("INSERT INTO event_outbox VALUES (1,'memory.forgotten','2026-08-23T10:00:00Z')").run();
    db.prepare("INSERT INTO event_outbox VALUES (2,'memory.forgotten','2026-08-20T10:00:00Z')").run();
    db.prepare("INSERT INTO event_outbox VALUES (3,'memory.created','2026-08-23T10:00:00Z')").run();

    const result = cleanupResidue(db, { startedAt: '2026-08-23T09:00:00Z', deletedIds: [] });

    expect(result.outbox).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_outbox').get()).toEqual({ n: 2 });
    db.close();
  });

  it('격리된 ID 를 참조하는 forgetting_event 만 지운다 (SC-005b)', () => {
    const db = createResidueDb();
    db.prepare("INSERT INTO memory_forgetting_event VALUES (1,'mem_gone','hard')").run();
    db.prepare("INSERT INTO memory_forgetting_event VALUES (2,'mem_alive','review')").run();

    const result = cleanupResidue(db, { startedAt: '2026-08-23T09:00:00Z', deletedIds: ['mem_gone'] });

    expect(result.forgettingEvents).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM memory_forgetting_event WHERE memory_id = 'mem_alive'").get())
      .toEqual({ n: 1 });
    db.close();
  });
});

describe('readDeletedIds', () => {
  it('진행 기록에서 성공 ID 를 모은다', () => {
    const file = join(dir, 'progress.jsonl');
    appendJsonl(file, { batch: 1, at: 'x', ok: ['mem_a', 'mem_b'], failed: [] });
    appendJsonl(file, { batch: 2, at: 'x', ok: ['mem_c'], failed: [{ id: 'mem_d', error: 'e' }] });

    expect(readDeletedIds(file)).toEqual(['mem_a', 'mem_b', 'mem_c']);
  });

  it('파일이 없으면 빈 배열이다', () => {
    expect(readDeletedIds(join(dir, 'nope.jsonl'))).toEqual([]);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts -t cleanupResidue`
Expected: FAIL — `cleanupResidue is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-run.ts` 에 추가)**

```ts
import { existsSync, readFileSync } from 'node:fs';

/**
 * FR-009a: forget 은 삭제 건당 event_outbox 에 memory.forgotten 을 적재하고 정리 로직이 없다.
 * FR-006d: memory_forgetting_event 는 FK 가 없어 자동 정리되지 않는다.
 * FR-006f: 살아 있는 기억의 로그는 건드리지 않는다 — #810 범위다.
 */
export function cleanupResidue(
  db: CliDatabase,
  args: { startedAt: string; deletedIds: string[] },
): { outbox: number; forgettingEvents: number } {
  const outbox = db.prepare(`
    DELETE FROM event_outbox WHERE event_type = 'memory.forgotten' AND created_at >= ?
  `).run(args.startedAt).changes;

  const deleteEvent = db.prepare('DELETE FROM memory_forgetting_event WHERE memory_id = ?');
  let forgettingEvents = 0;
  const deleteAll = db.transaction((ids: string[]) => {
    for (const id of ids) {
      forgettingEvents += deleteEvent.run(id).changes;
    }
  });
  deleteAll(args.deletedIds);

  return { outbox, forgettingEvents };
}

export function readDeletedIds(progressFile: string): string[] {
  if (!existsSync(progressFile)) {
    return [];
  }
  return readFileSync(progressFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => (JSON.parse(line) as ProgressRow).ok);
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: PASS (12 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-run.ts scripts/lib/quarantine-run.spec.ts
git commit -m "feat(065): clean outbox and forgetting-event residue for quarantined ids only"
```

---

### T017 [TDD] `VACUUM` 과 크기 기록

**Files:**
- Modify: `scripts/lib/quarantine-run.ts`
- Modify: `scripts/lib/quarantine-run.spec.ts`

**Interfaces:**
- Produces: `vacuumAndMeasure(db, dbPath: string): { before: number; after: number; reclaimed: number }`

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('vacuumAndMeasure (FR-010, SC-007)', () => {
  it('전후 파일 크기와 감소량을 기록한다', () => {
    const file = join(dir, 'vac.db');
    const db = new Database(file);
    db.exec('CREATE TABLE blob_rows (id INTEGER PRIMARY KEY, payload TEXT)');
    const insert = db.prepare('INSERT INTO blob_rows (payload) VALUES (?)');
    for (let i = 0; i < 2000; i += 1) insert.run('x'.repeat(500));
    db.exec('DELETE FROM blob_rows');

    const result = vacuumAndMeasure(db, file);

    expect(result.before).toBeGreaterThan(result.after);
    expect(result.reclaimed).toBe(result.before - result.after);
    db.close();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts -t vacuumAndMeasure`
Expected: FAIL — `vacuumAndMeasure is not a function`

- [x] **Step 3: 최소 구현**

```ts
import { statSync } from 'node:fs';

/** FR-010: 잔재 정리가 VACUUM 보다 앞이어야 한다 — 아니면 감소량이 37.7MB 이상 과소 보고된다. */
export function vacuumAndMeasure(db: CliDatabase, dbPath: string): {
  before: number; after: number; reclaimed: number;
} {
  const before = statSync(dbPath).size;
  db.exec('VACUUM');
  const after = statSync(dbPath).size;
  return { before, after, reclaimed: before - after };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: PASS (13 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-run.ts scripts/lib/quarantine-run.spec.ts
git commit -m "feat(065): vacuum and record database size reclaimed"
```

---

### T018 [TDD] 게이트 12종 배선과 `execute`·`rehearse`·`cleanup`·`vacuum` 명령

**Files:**
- Modify: `scripts/lib/quarantine-gates.ts`
- Modify: `scripts/lib/quarantine-gates.spec.ts`
- Modify: `scripts/quarantine-pipeline-semantic.ts`
- Modify: `scripts/quarantine-pipeline-semantic.spec.ts`

**Interfaces:**
- Produces: `buildExecuteGates(args: ExecuteGateInputs): Gate[]`

```ts
export interface ExecuteGateInputs {
  dbPathIsAbsolute: boolean;
  foreignKeysOn: boolean;
  serverStopped: boolean;
  integrityCheckPassed: boolean;
  backup: { exists: boolean; sizeRatio: number; sidecarsClean: boolean };
  copyABootVerified: boolean;
  copyBRehearsalPassed: boolean;
  falsePositives: { agree: boolean; emptySubject: number };
  kgPreservationRate: number;
  driftPercent: number;
  driftTolerance: number;
  relationsExportExists: boolean;
  beforeProbeExists: boolean;
}
```

계약의 게이트 번호와 종료 코드는 1:1로 고정한다.

| # | 게이트 | 코드 |
|---:|---|---:|
| 1 | `DB_PATH` 절대 경로 | 10 |
| 2 | `PRAGMA foreign_keys = ON` | 11 |
| 3 | 러너 외 쓰기 프로세스 없음 | 12 |
| 4 | `db:pre-docker-deploy` 통과 | 13 |
| 5 | 백업 존재 + 크기 대조 + sidecar | 14 |
| 6 | 사본 A 구동 검증 | 15 |
| 7 | 사본 B 리허설 통과 | 16 |
| 8 | 오탐 전수 검증 0건 | 17 |
| 9 | `kg_triple` 보존율 100% | 18 |
| 10 | 재집계 편차 ≤ 허용치 | 19 |
| 11 | `relations.jsonl` 존재 | 20 |
| 12 | `before.json` 존재 | 21 |

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('buildExecuteGates (계약 중단 게이트)', () => {
  const passing: ExecuteGateInputs = {
    dbPathIsAbsolute: true, foreignKeysOn: true, serverStopped: true, integrityCheckPassed: true,
    backup: { exists: true, sizeRatio: 0.99, sidecarsClean: true },
    copyABootVerified: true, copyBRehearsalPassed: true,
    falsePositives: { agree: true, emptySubject: 0 },
    kgPreservationRate: 1, driftPercent: 0.11, driftTolerance: 5,
    relationsExportExists: true, beforeProbeExists: true,
  };

  it('전부 통과하면 null 이다', () => {
    expect(runGates(buildExecuteGates(passing))).toBeNull();
  });

  it.each([
    ['dbPathIsAbsolute', { dbPathIsAbsolute: false }, 10],
    ['foreignKeysOn', { foreignKeysOn: false }, 11],
    ['serverStopped', { serverStopped: false }, 12],
    ['integrityCheckPassed', { integrityCheckPassed: false }, 13],
    ['backup 크기', { backup: { exists: true, sizeRatio: 0.02, sidecarsClean: true } }, 14],
    ['copyABootVerified', { copyABootVerified: false }, 15],
    ['copyBRehearsalPassed', { copyBRehearsalPassed: false }, 16],
    ['오탐', { falsePositives: { agree: false, emptySubject: 0 } }, 17],
    ['kg 보존율', { kgPreservationRate: 0.999 }, 18],
    ['재집계 편차', { driftPercent: 7 }, 19],
    ['relations.jsonl', { relationsExportExists: false }, 20],
    ['before.json', { beforeProbeExists: false }, 21],
  ])('%s 실패 시 종료 코드 %i', (_name, patch, code) => {
    expect(runGates(buildExecuteGates({ ...passing, ...patch as Partial<ExecuteGateInputs> }))?.code).toBe(code);
  });

  it('kg_triple 보존율은 100% 미만이면 무조건 막는다', () => {
    expect(runGates(buildExecuteGates({ ...passing, kgPreservationRate: 0.9999 }))?.code).toBe(18);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-gates.spec.ts -t buildExecuteGates`
Expected: FAIL — `buildExecuteGates is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-gates.ts` 에 추가)**

```ts
export interface ExecuteGateInputs {
  dbPathIsAbsolute: boolean;
  foreignKeysOn: boolean;
  serverStopped: boolean;
  integrityCheckPassed: boolean;
  backup: { exists: boolean; sizeRatio: number; sidecarsClean: boolean };
  copyABootVerified: boolean;
  copyBRehearsalPassed: boolean;
  falsePositives: { agree: boolean; emptySubject: number };
  kgPreservationRate: number;
  driftPercent: number;
  driftTolerance: number;
  relationsExportExists: boolean;
  beforeProbeExists: boolean;
}

/** 백업이 라이브의 90% 미만이면 부분 파일로 본다 (0바이트 산출물이 실재한 전례). */
const BACKUP_MIN_SIZE_RATIO = 0.9;

export function buildExecuteGates(input: ExecuteGateInputs): Gate[] {
  return [
    { id: 1, name: 'DB_PATH 절대 경로', code: 10,
      check: () => input.dbPathIsAbsolute || 'DB_PATH 가 절대 경로가 아닙니다' },
    { id: 2, name: 'PRAGMA foreign_keys = ON', code: 11,
      check: () => input.foreignKeysOn || 'foreign_keys 가 꺼져 있어 연쇄 정리가 불가능합니다' },
    { id: 3, name: '러너 외 쓰기 프로세스 없음', code: 12,
      check: () => input.serverStopped || '프로덕션 서버가 살아 있습니다 (SQLITE_BUSY·신규 유입·망각 정책 위험)' },
    { id: 4, name: 'db:pre-docker-deploy 무결성 점검', code: 13,
      check: () => input.integrityCheckPassed || '무결성 점검이 실패했습니다' },
    { id: 5, name: '백업 존재 · 크기 대조 · sidecar', code: 14,
      check: () => {
        if (!input.backup.exists) return '백업(사본 A)이 없습니다';
        if (input.backup.sizeRatio < BACKUP_MIN_SIZE_RATIO) {
          return `사본 A 가 라이브의 ${(input.backup.sizeRatio * 100).toFixed(1)}% 크기입니다 — 부분 파일 의심`;
        }
        if (!input.backup.sidecarsClean) return '-wal/-shm sidecar 잔재가 남아 있습니다';
        return true;
      } },
    { id: 6, name: '사본 A 구동 검증', code: 15,
      check: () => input.copyABootVerified || '사본 A 가 서버로 구동되지 않았습니다 — 롤백 근거가 없습니다' },
    { id: 7, name: '사본 B 리허설', code: 16,
      check: () => input.copyBRehearsalPassed || '리허설이 통과하지 않았습니다' },
    { id: 8, name: '오탐 전수 검증', code: 17,
      check: () => {
        if (input.falsePositives.emptySubject > 0) {
          return `대상에 subject 결여 행 ${input.falsePositives.emptySubject}건 — 판별식 결함`;
        }
        return input.falsePositives.agree || '두 판별 방식의 건수가 갈립니다 — 오분류 존재';
      } },
    { id: 9, name: 'kg_triple 보존율 100%', code: 18,
      check: () => input.kgPreservationRate >= 1
        || `보존율 ${(input.kgPreservationRate * 100).toFixed(4)}% — 차이만큼이 진짜 소실입니다` },
    { id: 10, name: '실행 직전 재집계 편차', code: 19,
      check: () => Math.abs(input.driftPercent) <= input.driftTolerance
        || `편차 ${input.driftPercent.toFixed(2)}% 가 허용치 ${input.driftTolerance}% 를 넘습니다` },
    { id: 11, name: 'relations.jsonl 존재', code: 20,
      check: () => input.relationsExportExists || '관계 내보내기가 없습니다 — 유일한 복구 근거입니다' },
    { id: 12, name: 'before.json 존재', code: 21,
      check: () => input.beforeProbeExists || '사전 프로브 기록이 없습니다 — 전후 대조가 불가능합니다' },
  ];
}
```

- [x] **Step 4: 진입점에 나머지 명령을 배선한다**

```ts
  const progressFile = join(outDir, 'progress.jsonl');

  if (options.command === 'rehearse' || options.command === 'execute') {
    const db = openForWrite(dbPath);
    try {
      if (options.command === 'execute') {
        const failure = runGates(buildExecuteGates(collectGateInputs(db, dbPath, outDir, options)));
        if (failure) {
          throw new QuarantineGateError(failure.code, failure.reason);
        }
      }
      const summary = await runQuarantine({
        db,
        forget: createForgetFn(db),
        batchSize: options.batchSize,
        onBatch: (row) => appendJsonl(progressFile, row),
      });
      console.log(`[quarantine-065] ${summary.batches}배치 · 삭제 ${summary.deleted}건 · 실패 ${summary.failed.length}건`);
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'cleanup') {
    // 실행 시작 시각이 없으면 outbox DELETE 가 0행을 지우고도 조용히 성공한다.
    // 지금 시각으로 대체하지 않는다 — 그 폴백이 정확히 실패를 감추는 경로다.
    const runStartedAt = process.env.QUARANTINE_STARTED_AT;
    if (!runStartedAt) {
      throw new QuarantineGateError(1, 'QUARANTINE_STARTED_AT 이 필요합니다 (execute 직전에 export 한 값)');
    }
    const db = openForWrite(dbPath);
    try {
      const result = cleanupResidue(db, { startedAt: runStartedAt, deletedIds: readDeletedIds(progressFile) });
      console.log(`[quarantine-065] outbox ${result.outbox}행 · forgetting_event ${result.forgettingEvents}행 정리`);
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'vacuum') {
    const db = openForWrite(dbPath);
    try {
      const result = vacuumAndMeasure(db, dbPath);
      console.log(`[quarantine-065] ${result.before} → ${result.after} 바이트 (회수 ${result.reclaimed})`);
    } finally {
      db.close();
    }
    return;
  }
```

진입점에 필요한 추가 import:

```ts
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildExecuteGates, openForWrite, runGates, type ExecuteGateInputs } from './lib/quarantine-gates.js';
import { appendJsonl, exportRelations, resolveOutDir } from './lib/quarantine-report.js';
import { countTargets, crossVerifyTargets, kgPreservation } from './lib/quarantine-targets.js';
import { cleanupResidue, createForgetFn, readDeletedIds, runQuarantine, vacuumAndMeasure } from './lib/quarantine-run.js';
import type { CliDatabase } from './lib/cli.js';
```

`collectGateInputs`는 운영자가 넘긴 확인 결과(서버 정지·무결성·백업·리허설)를 환경 변수로 읽고,
DB에서 읽을 수 있는 것(FK·오탐·보존율·편차)은 직접 집계한다. 사람이 확인해야 하는 게이트를
러너가 스스로 통과시키지 않는 것이 핵심이다.

```ts
function envFlag(name: string): boolean {
  return process.env[name] === '1';
}

function collectGateInputs(db: CliDatabase, dbPath: string, outDir: string, options: Options): ExecuteGateInputs {
  const cross = crossVerifyTargets(db);
  const kg = kgPreservation(db);
  // 게이트 10은 fail-closed 여야 한다. 미설정이면 편차 0으로 통과시키는 것이 아니라 막는다.
  const declared = Number.parseInt(process.env.QUARANTINE_EXPECTED_TARGETS ?? '', 10);
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new QuarantineGateError(19, 'QUARANTINE_EXPECTED_TARGETS 가 없습니다 — 재집계 대조를 건너뛸 수 없습니다');
  }
  // FR-004b: 재개 시에는 직전 진행 기록의 누적 성공 수를 반영한 기대값과 대조한다.
  const alreadyDeleted = options.resume ? readDeletedIds(join(outDir, 'progress.jsonl')).length : 0;
  const expected = declared - alreadyDeleted;
  const actual = countTargets(db);
  const driftPercent = expected <= 0 ? 100 : ((actual - expected) / expected) * 100;

  return {
    dbPathIsAbsolute: isAbsolute(dbPath),
    foreignKeysOn: db.pragma('foreign_keys', { simple: true }) === 1,
    serverStopped: envFlag('QUARANTINE_SERVER_STOPPED'),
    integrityCheckPassed: envFlag('QUARANTINE_INTEGRITY_OK'),
    backup: {
      exists: envFlag('QUARANTINE_BACKUP_OK'),
      sizeRatio: Number.parseFloat(process.env.QUARANTINE_BACKUP_RATIO ?? '0'),
      sidecarsClean: envFlag('QUARANTINE_BACKUP_SIDECARS_CLEAN'),
    },
    copyABootVerified: envFlag('QUARANTINE_COPY_A_BOOTED'),
    copyBRehearsalPassed: envFlag('QUARANTINE_REHEARSAL_OK'),
    falsePositives: { agree: cross.agree, emptySubject: cross.emptySubject },
    kgPreservationRate: kg.rate,
    driftPercent,
    driftTolerance: options.driftTolerance,
    relationsExportExists: existsSync(join(outDir, 'relations.jsonl')),
    beforeProbeExists: existsSync(join(outDir, 'before.json')),
  };
}
```

- [x] **Step 5: 통과를 확인한다**

Run: `npx vitest --run scripts/`
Expected: PASS (전체)

- [x] **Step 6: 커밋**

```bash
git add scripts/lib/quarantine-gates.ts scripts/lib/quarantine-gates.spec.ts scripts/quarantine-pipeline-semantic.ts scripts/quarantine-pipeline-semantic.spec.ts
git commit -m "feat(065): wire twelve abort gates to exit codes and remaining subcommands"
```

**Checkpoint**: 러너가 완성됐다. 여기부터는 코드가 아니라 운영 절차다.

---

### T019 [REVIEW] 사본 A 백업 · 크기 대조 · 구동 검증

**서버를 켜 둔 채 진행한다.** 정지 구간이 아니다(FR-008b).

- [ ] **Step 1: 백업을 만든다 (사본 A = 롤백 근거)**

```bash
export DB_PATH="$HOME/.memento/data/memory.db"
npm run db:backup
```

- [ ] **Step 2: 크기를 대조한다 (게이트 5, 종료 코드 14)**

```bash
BACKUP=$(ls -t "$(dirname "$DB_PATH")/backups"/memory-backup-*.db | head -1)
LIVE_SIZE=$(stat -c%s "$DB_PATH"); BACKUP_SIZE=$(stat -c%s "$BACKUP")
echo "live=$LIVE_SIZE backup=$BACKUP_SIZE ratio=$(echo "scale=4; $BACKUP_SIZE/$LIVE_SIZE" | bc)"
ls -la "$BACKUP"-wal "$BACKUP"-shm 2>/dev/null && echo "sidecar 잔재 있음 — 확인 필요"
```
Expected: ratio ≥ 0.9. 산출물 19개 중 0바이트 파일이 실재하므로 이 대조를 건너뛰지 않는다.

- [ ] **Step 3: 사본 B 를 복제한다**

```bash
cp "$BACKUP" /tmp/quarantine-copy-b.db
```

- [ ] **Step 4: 사본 A 를 구동해 내용을 검증한다 (게이트 6, 종료 코드 15)**

```bash
DB_PATH="$BACKUP" npm run dev
# 다른 터미널에서 질의 10개를 memory_injection 으로 호출해 정상 반환을 확인한다
# 타입별 건수를 라이브와 대조한다
```
구동이나 대조가 실패하면 **파괴적 실행으로 진행하지 않는다.** 부분 파일은 스키마가 온전해
구동에 성공할 수도 있으므로 Step 2 의 크기 대조가 앞에 있어야 한다.

---

### T020 [REVIEW] 사본 B 전량 리허설과 의도적 중단·재개

리허설이 실패하면 **라이브를 건드리지 않는다**(FR-006g, SC-008b).

- [ ] **Step 1: 소요 시간을 재며 전량 격리를 돌린다 (SC-007a)**

```bash
time DB_PATH=/tmp/quarantine-copy-b.db \
  npm run memory:quarantine-065 -- rehearse --out /tmp/q065-rehearsal
```

- [ ] **Step 2: 도중에 한 번 죽이고 재개한다 (SC-006a)**

```bash
# 임의 지점에서 Ctrl-C 후
DB_PATH=/tmp/quarantine-copy-b.db \
  npm run memory:quarantine-065 -- rehearse --resume --out /tmp/q065-rehearsal
```
Expected: 최종 잔여 대상 0건. **라이브에서는 중단을 일부러 만들지 않는다.**

- [ ] **Step 3: 잔재를 정리하고 회수량을 잰다**

```bash
DB_PATH=/tmp/quarantine-copy-b.db npm run memory:quarantine-065 -- cleanup --out /tmp/q065-rehearsal
DB_PATH=/tmp/quarantine-copy-b.db npm run memory:quarantine-065 -- vacuum  --out /tmp/q065-rehearsal
```

- [ ] **Step 4: 연쇄 잔재 0행을 확인한다 (SC-005)**

```bash
sqlite3 /tmp/quarantine-copy-b.db "
SELECT 'embedding', COUNT(*) FROM memory_embedding WHERE memory_id NOT IN (SELECT id FROM memory_item);
SELECT 'relation',  COUNT(*) FROM memory_relation
  WHERE source_id NOT IN (SELECT id FROM memory_item) OR target_id NOT IN (SELECT id FROM memory_item);
SELECT 'outbox',    COUNT(*) FROM event_outbox WHERE event_type = 'memory.forgotten';
SELECT 'fevent',    COUNT(*) FROM memory_forgetting_event WHERE memory_id NOT IN (SELECT id FROM memory_item);"
```
Expected: 넷 다 0 (SC-005, SC-005a, SC-005b).

> ⚠️ 마지막 `NOT IN` 은 **확인용이다.** 이 조건을 `cleanup` 의 DELETE 에 옮겨 쓰면 우리와 무관한
> 고아까지 지워 FR-006f 를 위반한다. 삭제는 반드시 격리된 ID 목록으로만 한다. **벡터·FTS 잔재는 `sqlite3` CLI 로 확인할 수 없다** — `vec0`·`fts5` 모듈이
없어 테이블이 열리지 않는다. 확장을 로드한 경로로 확인한다(FR-006j): 다음 Step.

- [ ] **Step 5: 확장을 로드한 경로로 벡터·FTS 잔재를 확인한다 (FR-006j)**

```bash
DB_PATH=/tmp/quarantine-copy-b.db node --import tsx -e "
import('@memento/core').then(async (m) => {
  const db = await m.initializeDatabase('/tmp/quarantine-copy-b.db');
  for (const t of ['memory_item_vec','memory_item_vec_minilm','memory_item_fts']) {
    try { console.log(t, db.prepare(\`SELECT COUNT(*) AS n FROM \${t}\`).get()); }
    catch (e) { console.log(t, 'ERR', e.message); }
  }
});"
```
사본이므로 `initializeDatabase` 의 쓰기가 허용된다. **라이브에서는 절대 쓰지 않는다.**

- [ ] **Step 6: 실측값을 기록한다**

리허설 소요 시간을 `.local/quarantine-065/dry-run-report.md` 에 덧붙인다. 이 값이
서버 정지 창구 산정의 근거다. 감당 가능한 정지 시간을 넘으면 실행을 여러 창구로 나눈다
(재개가 기본 경로이므로 분할 실행 자체는 추가 설계가 필요 없다).

---

### T021 [REVIEW] 라이브 실행 — 서버 정지 구간

⚠️ **되돌리기 어려운 작업이다. 앞의 모든 `[REVIEW]` 게이트가 통과한 뒤에만 시작한다.**
정지 구간은 **재집계부터 `VACUUM` 완료까지**다(FR-008b).

- [x] **Step 1: 프로덕션 서버를 정지한다** — 2026-08-23 21:40:26 KST

```bash
docker compose stop   # 또는 운영 방식에 맞게
```

- [x] **Step 2: 무결성을 점검한다 (게이트 4)** — `quick_check ok` · 백업 재생성 (비율 1.0000)

```bash
npm run db:pre-docker-deploy
```

- [x] **Step 3: 게이트 입력을 사람이 확인한 값으로 채운다** — 8개 전부 실측 확인 후 설정

```bash
export DB_PATH="$HOME/.memento/data/memory.db"
export QUARANTINE_SERVER_STOPPED=1
export QUARANTINE_INTEGRITY_OK=1
export QUARANTINE_BACKUP_OK=1
export QUARANTINE_BACKUP_RATIO=0.99          # T019 Step 2 의 실측값
export QUARANTINE_BACKUP_SIDECARS_CLEAN=1
export QUARANTINE_COPY_A_BOOTED=1
export QUARANTINE_REHEARSAL_OK=1
export QUARANTINE_EXPECTED_TARGETS=24113     # dry-run 리포트의 대상 건수
export QUARANTINE_STARTED_AT=$(date -Iseconds)
```
확인하지 않은 항목에 `1`을 넣지 말 것. 게이트의 존재 이유가 사라진다.
`QUARANTINE_EXPECTED_TARGETS` 와 `QUARANTINE_STARTED_AT` 은 **미설정 시 실행이 막힌다**(각각 종료
코드 19, 1). `--resume` 으로 재개하면 러너가 `progress.jsonl` 의 누적 성공 수를 기대값에서 빼고
편차를 계산하므로(FR-004b), 재개할 때도 같은 값을 그대로 쓴다.

- [x] **Step 4: 격리를 실행한다** — 242배치 · 24,138건 · 실패 0 · 325.3초

```bash
npm run memory:quarantine-065 -- execute
```
게이트에서 멈추면 종료 코드로 원인을 본다(10~21). 중단 후에는 `--resume` 으로 재개한다.
부분 삭제 상태는 손상이 아니다(FR-005c).

- [x] **Step 5: 잔재를 정리하고 공간을 회수한다 (순서 중요)** — `forgetting_event` 229,523행 · `VACUUM` 556,228,608 → 128,688,128

```bash
npm run memory:quarantine-065 -- cleanup
npm run memory:quarantine-065 -- vacuum
```
`cleanup` 을 건너뛰고 `vacuum` 하면 감소량이 37.7MB 이상 과소 보고된다(FR-010).

- [x] **Step 6: 실패 시 롤백 (판별식이 틀렸다고 판단한 경우에만)** — 해당 없음. 실패 0건

```bash
docker compose stop
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
cp "$BACKUP" "$DB_PATH"
docker compose start
```

### 2026-08-23 실행 실측

| 항목 | 값 |
|---|---|
| 정지 구간 | 21:40:26 → 21:58:25 KST (**17분 59초**) |
| 대상 재집계 | **24,138건** (계획 시점 24,113 → +25, 편차 0.10%) |
| 실행 | 242배치 · 삭제 24,138 · 실패 **0** · **325.3초** |
| 잔재 정리 | `memory_forgetting_event` 229,523행 · `event_outbox` 0행 |
| `VACUUM` | 556,228,608 → 128,688,128 (**회수 408MB, 77%**) |
| 리허설(사본 B) | 242배치 · 24,138 · 실패 0 · 309.5초 — 라이브와 5% 이내 |

사후 검증: `quick_check ok` · 잔여 대상 **0** · episodic 3,482 · procedural 252 **불변** ·
semantic 26,267 → 2,129 · `kg_triple` 24,285 **100% 보존** · 형태 (2)(3) 145건 보존 ·
pinned 1 · 귀속 111 불변 · 고아 embedding/relation 0 · `memory_item_fts` = `memory_item`.

**Checkpoint**: User Story 2 완료. 대상이 사라지고 연쇄 잔재가 정리됐다.

---

## Phase 5: User Story 3 — 격리 효과와 부수 피해 없음을 검증한다 (P3)

**Goal**: 사본 A(전)·사본 B(후)에 같은 질의 10개를 돌려 사람이 쓴 기억이 실제로 올라왔는지 대조하고,
격리 대상이 아닌 것이 하나도 사라지지 않았음을 확인한다.

**Independent Test**: `after.json` 에 형태 (1)이 0건이고, 사람이 쓴 기억의 비율이 `before.json` 대비
상승했으며, episodic·procedural 건수가 실행 직전 재집계값과 같다.

> ⚠️ **우선순위와 실행 순서가 다르다.** US3은 우선순위 P3이지만, **T023(before 프로브)은
> T021(라이브 실행)의 선행 조건**이다 — 게이트 12가 `before.json` 의 존재를 요구한다. 이유는
> `memory_injection` 이 읽기 전용이 아니어서 라이브에서 프로브하면 측정이 자기충족적이 되기
> 때문이다(FR-003b). 사본 A 에서 먼저 찍어 두어야 대조가 성립한다.

---

### T022 [TDD] [P] 전후 프로브 대조 함수

**Files:**
- Modify: `scripts/lib/quarantine-run.ts`
- Modify: `scripts/lib/quarantine-run.spec.ts`

**Interfaces:**
- Produces: `interface ProbeEntry { query: string; returned: Array<{ id: string; type: string; form: 0 | 1 | 2 | 3 }> }`,
  `compareProbes(before: ProbeEntry[], after: ProbeEntry[]): ProbeComparison`

`form: 0` = triple 컬럼이 없는 기억(사람이 쓴 것). 1·2·3 은 §본문 형태 분류와 같다.

- [x] **Step 1: 실패하는 테스트를 추가한다**

```ts
describe('compareProbes (SC-001, SC-001a)', () => {
  it('격리 후 형태 (1) 이 0건이면 통과로 본다', () => {
    const before: ProbeEntry[] = [{
      query: '검색 랭킹 공식', returned: [
        { id: 'mem_t1', type: 'semantic', form: 1 },
        { id: 'mem_e1', type: 'episodic', form: 0 },
      ],
    }];
    const after: ProbeEntry[] = [{
      query: '검색 랭킹 공식', returned: [
        { id: 'mem_e1', type: 'episodic', form: 0 },
        { id: 'mem_p1', type: 'procedural', form: 0 },
      ],
    }];

    expect(compareProbes(before, after)).toEqual({
      formOneAfter: 0,
      humanRatioBefore: 0.5,
      humanRatioAfter: 1,
      humanRatioImproved: true,
      passed: true,
    });
  });

  it('형태 (1) 이 남아 있으면 실패로 본다', () => {
    const probes: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_t', type: 'semantic', form: 1 }] }];
    expect(compareProbes(probes, probes).passed).toBe(false);
  });

  it('보존된 형태 (2) 가 반환돼도 실패가 아니다 (SC-001 단서)', () => {
    const before: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_t', type: 'semantic', form: 1 }] }];
    const after: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_f2', type: 'semantic', form: 2 }] }];
    expect(compareProbes(before, after).formOneAfter).toBe(0);
  });

  it('반환이 0건이면 비율을 0 으로 둔다', () => {
    expect(compareProbes([], []).humanRatioBefore).toBe(0);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts -t compareProbes`
Expected: FAIL — `compareProbes is not a function`

- [x] **Step 3: 최소 구현 (`quarantine-run.ts` 에 추가)**

```ts
export interface ProbeEntry {
  query: string;
  returned: Array<{ id: string; type: string; form: 0 | 1 | 2 | 3 }>;
}

export interface ProbeComparison {
  formOneAfter: number;
  humanRatioBefore: number;
  humanRatioAfter: number;
  humanRatioImproved: boolean;
  passed: boolean;
}

/** 사람이 쓴 기억 = episodic·procedural·triple 컬럼이 없는 semantic(form 0) */
function humanRatio(entries: ProbeEntry[]): number {
  const all = entries.flatMap((entry) => entry.returned);
  if (all.length === 0) {
    return 0;
  }
  return all.filter((row) => row.form === 0).length / all.length;
}

export function compareProbes(before: ProbeEntry[], after: ProbeEntry[]): ProbeComparison {
  const formOneAfter = after.flatMap((entry) => entry.returned).filter((row) => row.form === 1).length;
  const humanRatioBefore = humanRatio(before);
  const humanRatioAfter = humanRatio(after);
  const humanRatioImproved = humanRatioAfter > humanRatioBefore;

  return {
    formOneAfter,
    humanRatioBefore,
    humanRatioAfter,
    humanRatioImproved,
    passed: formOneAfter === 0 && humanRatioImproved,
  };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest --run scripts/lib/quarantine-run.spec.ts`
Expected: PASS (17 tests)

- [x] **Step 5: 커밋**

```bash
git add scripts/lib/quarantine-run.ts scripts/lib/quarantine-run.spec.ts
git commit -m "feat(065): compare before/after probes for template removal and human-authored ratio"
```

---

### T023 [REVIEW] 사본 프로브 실행 — **T021 의 선행 조건**

- [ ] **Step 1: 질의 10개를 확정하고 고정한다 (FR-003a)**

`.local/quarantine-065/queries.json` 에 배열로 남긴다. 이후 전·후에서 **문자 그대로 같은 질의**를
쓴다. 실제 운영에서 자주 쓰는 질의를 고른다.

- [ ] **Step 2: 사본 A 에 서버를 붙여 before 를 찍는다**

```bash
DB_PATH="$BACKUP" npm run dev
# 질의 10개를 memory_injection 으로 1회씩 호출하고
# 질의별 반환 ID·타입·본문 형태를 .local/quarantine-065/before.json 에 저장한다
```

- [ ] **Step 3: 진단용 `recall` 에는 앵커 자동 설정을 끈다 (FR-003c, #811)**

`recall` 을 쓰는 경우 `auto_set_anchor: false` 를 준다. 앵커 슬롯이 프로브 때문에 바뀌면
운영 상태가 오염된다.

- [ ] **Step 4: 사본 B(리허설 완료본)에 서버를 붙여 after 를 찍는다**

```bash
DB_PATH=/tmp/quarantine-copy-b.db npm run dev
# 같은 질의 10개 → .local/quarantine-065/after.json
```

- [ ] **Step 5: 대조 결과를 확인한다**

```bash
node --import tsx -e "
import { readFileSync } from 'node:fs';
import { compareProbes } from './scripts/lib/quarantine-run.js';
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
console.log(compareProbes(read('.local/quarantine-065/before.json'), read('.local/quarantine-065/after.json')));
"
```
Expected: `formOneAfter: 0`, `humanRatioImproved: true`, `passed: true`

**두 사본이 프로브를 정확히 1회씩만 받았는지** 확인한다. 오염이 대칭이어야 대조가 공정하다.
라이브에서는 절대 프로브하지 않는다 — `knowledge-context-bundle-builder` 가 `recall_count`·
`g_value`·`consolidation_score` 를 UPDATE 한다.

---

### T024 [REVIEW] 사후 확인과 재기동

- [x] **Step 1: 보존 대상이 그대로인지 확인한다 (SC-002, SC-003a, SC-003d, SC-003f)** — 전부 통과

```bash
sqlite3 "file:$DB_PATH?mode=ro" "
SELECT type, COUNT(*) FROM memory_item GROUP BY type;
SELECT 'pinned', COUNT(*) FROM memory_item WHERE pinned = TRUE;
SELECT 'attributed', COUNT(*) FROM memory_item WHERE project_id IS NOT NULL OR owner_id IS NOT NULL;
SELECT 'form_2_3', COUNT(*) FROM memory_item
  WHERE type='semantic' AND subject IS NOT NULL AND subject <> ''
    AND NOT (substr(content,1,length(trim(subject)))=trim(subject)
             AND substr(content,length(trim(subject))+2,1)=' ');"
```
Expected: episodic·procedural 이 실행 직전 재집계값과 동일. pinned·귀속 건수 불변.
형태 (2)(3) 전량 보존(실측 기준 120건).

- [x] **Step 2: 연쇄 잔재 0행을 확인한다 (SC-005, SC-005a, SC-005b)** — 고아 embedding 0 · 고아 relation 0 · `event_outbox` `memory.forgotten` 0

T020 Step 4·5 와 같은 쿼리를 라이브에 돌린다. `event_outbox` 의 `memory.forgotten` 0행(SC-005a)과
격리된 ID 를 참조하는 `memory_forgetting_event` 0행(SC-005b)을 함께 센다 — 격리 대상이 아닌
기억을 참조하는 행의 건수는 **변하지 않아야 한다**. 벡터·FTS 는 확장을 로드한 경로로 확인하되
**`initializeDatabase` 를 쓰지 않는다** — 마이그레이션이 라이브에 쓴다. 사본에 붙인 서버
인스턴스로 확인하거나, `sqlite-vec` 확장만 로드한 읽기 전용 스크립트를 쓴다.

- [x] **Step 3: 크기 감소를 기록한다 (SC-007)** — 회수 427,540,480바이트 (408MB, 77%)

기대 회수량: 임베딩 약 193.96MB + `memory_forgetting_event` 고아 약 37.7MB + 본문 약 1.0MB.
**실제 감소량이 이보다 크게 작으면 잔재 정리가 누락된 것이다.**

- [x] **Step 4: 정지 구간 길이를 기록한다 (SC-008c)** — 21:40:26 → 21:58:25 = **17분 59초**

재집계 시작 ~ `VACUUM` 완료. 리허설 소요와 **별도로** 남긴다.

- [x] **Step 5: 재기동한다 (FR-008c)** — 21:58:25 `health: healthy`, `database: connected`

```bash
docker compose start
```

**Checkpoint**: 모든 User Story 완료.

---

## Phase 6: Polish & Cross-Cutting

### T025 품질 게이트

- [x] **Step 1: 헌법 IV 의 세 게이트를 통과시킨다**

```bash
npm run lint
npm run type-check
npm test
```

- [x] **Step 2: 파일 크기를 확인한다**

```bash
npx tsx scripts/check-file-sizes.ts --directory scripts --threshold 500
```
Expected: 러너 5개 파일 모두 500줄 이하

- [x] **Step 3: graphify 는 적용하지 않는다**

산출물이 `scripts/` 러너와 문서뿐이고 `packages/` 아래 동작을 바꾸지 않으므로 헌법 v1.2.0 의
graphify 게이트는 **비적용**이다(plan.md Constitution Check). `packages/` 를 한 줄이라도
건드리게 되면 이 판정이 뒤집히므로 그때는 `graphify-out/GRAPH_REPORT.md` 를 재빌드한다.

---

### T026 [P] quickstart 검증과 롤백 절차 확인

- [x] **Step 1: `quickstart.md` 의 명령이 실제 계약과 맞는지 대조한다**

`npx tsx scripts/quarantine-pipeline-semantic.ts <command>` 로 적혀 있으나 T002 에서
`npm run memory:quarantine-065 -- <command>` 를 만들었다. **빌드 선행이 필요하므로 npm script
경로가 정답이다.** `quickstart.md` 와 `contracts/runner-cli.md` 의 호출 예시를 갱신한다.

- [x] **Step 2: 롤백 절차를 사본으로 리허설한다 (FR-007a)** — 2026-08-23 완료

```bash
cp /tmp/quarantine-copy-b.db /tmp/rollback-target.db
rm -f /tmp/rollback-target.db /tmp/rollback-target.db-wal /tmp/rollback-target.db-shm
cp "$BACKUP" /tmp/rollback-target.db
sqlite3 /tmp/rollback-target.db "SELECT type, COUNT(*) FROM memory_item GROUP BY type;"
```
Expected: 격리 전 건수와 일치

실측: 격리 후 상태 5,888행(semantic 2,112)에 사본 A를 덮어쓰니 **30,002행**
(episodic 3,463 · procedural 249 · semantic 26,226 · working 64)이 그대로 돌아왔다.
`cmp` 결과 백업과 **바이트 동일**, `quick_check ok`, `memory_item_fts` 30,002 = `memory_item`,
`kg_triple` 24,261, `memory_embedding` 28,562. 리허설 후 임시 파일은 삭제했다.

`memory_item_vec` 는 세지 못했다 — `openReadonly` 는 `vec0` 확장을 붙이지 않는다.
파일이 백업과 바이트 동일하므로 vec 테이블도 필연적으로 동일하다.

- [x] **Step 3: 커밋**

```bash
git add specs/065-804-triple-semantic-quarantine/quickstart.md specs/065-804-triple-semantic-quarantine/contracts/runner-cli.md
git commit -m "docs(065): align runner invocation examples with the npm script"
```

---

### T027 [P] 본문 유출 최종 확인 (SC-007b)

- [x] **Step 1: 커밋된 파일에 기억 본문이 없는지 확인한다** — 추적·이력 모두 0건

```bash
git status --porcelain
git log --oneline -20 --name-only | grep -E 'quarantine-065|\.local/' || echo "본문 산출물 커밋 없음"
```
Expected: `.local/quarantine-065/` 아래 파일이 하나도 추적되지 않는다

- [x] **Step 2: 공개 문서에 집계만 실렸는지 확인한다** — 예외 1건을 남기고 통과

spec·plan·tasks·이슈·PR 본문에 기억 **본문**이 아니라 건수·분포·ID·해시만 있는지 본다.

**예외**: `spec.md:23-25` 의 템플릿 문장 3줄은 남긴다. 이슈 #804 본문에서 그대로 옮긴 것이고,
파이프라인이 생성한 조각이라 사람이 쓴 기억이 아니며, 이것이 없으면 문제 정의가 성립하지 않는다.
FR-006b 가 막으려는 것은 표본 A 50건 같은 **사람이 쓴 본문**이다.

---

### T028 [P] 후속 이슈 등록

이 작업의 범위 밖이지만 실측으로 드러난 것들이다.

- [x] **Step 1: 폴백률 급증 이슈를 연다** — #813

재조립 실패율 2026-05 0.0% → 08 **11.6%**. 원인은 predicate 의 마지막 글자가 한글이 아니거나
구(句) 형태인 것(`triple-sentence.ts:18-19`). 격리 이후에도 계속 쌓이므로 FR-001b 의 제외 근거가
언제까지 유효한지를 좌우한다. #805 와 묶어 판단한다.

- [x] **Step 2: `backups/` 누적 이슈를 연다** — #814

6,899개 · 5.0GB. 이 중 6,880개는 `backup-manager.ts` 의 **마이그레이션 백업**이고 `db:backup`
산출물이 아니다. 0바이트 파일과 `-wal`/`-shm` 잔재가 남는 이유도 함께 본다.

- [x] **Step 3: 재추출 복구 경로를 문서로 남긴다 (FR-006l)** — [recovery.md](./recovery.md)

`relations.jsonl` 의 `extracted_from` 반대편이 출처 episodic ID 다. 재추출이 필요해지면 그
목록으로 `triple_extracted` 를 리셋한다. **선행 조건**: #805(재오염 차단)와 재조립 실패 원인 해소.
그 전에 리셋하면 같은 파편이, 폴백률 11.6% 를 감안하면 더 나쁜 것이 다시 쌓인다.

---

## Dependencies & Execution Order

### Phase 의존

```text
Phase 1 (Setup)
   └─► Phase 2 (Foundational) ── 모든 User Story 를 차단한다
          ├─► Phase 3 (US1, P1) ── 단독으로 가치 있음. 여기서 멈춰도 된다
          │      └─► Phase 4 (US2, P2) ── US1 의 확인 없이 실행할 수 없다
          │             └─► Phase 5 (US3, P3)
          └─► Phase 6 (Polish)
```

### 우선순위와 실행 순서의 어긋남 (중요)

**T023(before 프로브)은 T021(라이브 실행)보다 먼저 실행해야 한다.** 게이트 12가 `before.json`
존재를 요구하기 때문이다. 우선순위(P3)와 실행 순서가 다른 유일한 지점이다.

실제 운영 순서:

```text
T019 백업·사본 A/B  →  T023 Step 2 before 프로브(사본 A)
                     →  T020 사본 B 리허설
                     →  T023 Step 4 after 프로브(사본 B)
                     →  T023 Step 5 대조
                     →  [게이트 전부 통과?] ─ No ─► 중단 (라이브 삭제 0건)
                     →  T021 라이브 실행 (정지 구간)
                     →  T024 사후 확인 · 재기동
```

### 작업 의존

| 작업 | 선행 |
|---|---|
| T003, T005 | T002 |
| T004 | T003 (같은 파일) |
| T006 | T002 |
| T007, T008, T009, T010 | T006 (같은 파일 — 순차) |
| T011 | T005, T010 |
| T012 | T006, T011 |
| T013 | T011, T012, T001 |
| T014 | T003 |
| T015 | T006, T014 |
| T016, T017 | T014 (같은 파일 — 순차) |
| T018 | T004, T015, T016, T017 |
| T019 | T013 |
| T020 | T018, T019 |
| T021 | T020, **T023 Step 2** |
| T022 | T014 |
| T023 | T019, T020, T022 |
| T024 | T021 |
| T025~T028 | 전부 |

### 병렬 기회

- **T001 ∥ T002** — 다른 파일
- **T003/T004(gates) ∥ T005(report) ∥ T006(targets)** — Phase 2 완료 후 서로 다른 파일
- **T014(run) ∥ T011(report)** — 다른 파일. T018 이 둘을 합류시킨다
- **T022(compareProbes) ∥ T018(gates)** — 다른 파일
- **T026 ∥ T027 ∥ T028** — 전부 다른 파일

같은 파일을 건드리는 작업은 병렬로 돌리지 않는다. `quarantine-targets.ts` 는 T006~T010 이,
`quarantine-run.ts` 는 T014~T017·T022 가 순차로 쌓는다.

### 서브에이전트 위임

`[SUBAGENT]` 로 넘기기 좋은 것: T007, T009, T012, T017, T022 — 인터페이스가 좁고 테스트가
자족적이다. 넘기지 말 것: T018(게이트 배선 — 12종 코드 매핑이 계약과 정확히 맞아야 한다),
모든 `[REVIEW]` 작업(사람이 판단해야 하는 게이트다).

---

## 요구사항 추적

58개 FR 대부분은 리포트의 항목으로 수렴한다. 작업 단위로 접어 표시한다.

| 작업 | 충족 조항 |
|---|---|
| T001 | FR-006b, SC-007b |
| T002 | FR-005(배치 상한), 계약 플래그 |
| T003 | FR-009, FR-006, SC-004 |
| T004 | 계약 중단 게이트 프레임 |
| T005 | FR-006b, FR-005b(기록 형식) |
| T006 | FR-001, FR-001a, FR-001e, FR-002i, FR-002a(i) |
| T007 | FR-001b, FR-002f, FR-002g, FR-002h, SC-003c, SC-003d |
| T008 | FR-002, FR-002a, FR-002j, SC-003 |
| T009 | FR-001a, FR-001c, FR-001d, FR-001f, FR-002b, FR-002c, FR-002d, FR-002e, FR-003, SC-003b, SC-003e |
| T010 | FR-004, FR-004a, FR-004c, FR-004d, FR-006a, FR-006e, FR-006h, SC-004a, SC-004b |
| T011 | FR-003, FR-006b, SC-003b, SC-003c |
| T012 | FR-006i, FR-006l, SC-005c |
| T013 | FR-003, SC-003e, SC-004, SC-007b |
| T014 | FR-005, FR-005a, FR-005d |
| T015 | FR-005, FR-005b, FR-005c, SC-006a |
| T016 | FR-006d, FR-006f, FR-009a, SC-005a, SC-005b |
| T017 | FR-010, SC-007 |
| T018 | FR-004b, FR-006g, FR-007c, FR-008, FR-008a, FR-009, SC-004a, SC-006, SC-008, SC-008a, SC-008b |
| T019 | FR-007, FR-007b, FR-007c, SC-006 |
| T020 | FR-006c, FR-006g, FR-006j, SC-005, SC-006a, SC-007a, SC-008b |
| T021 | FR-005, FR-008a, FR-008b, FR-011 |
| T022 | SC-001, SC-001a |
| T023 | FR-003a, FR-003b, FR-003c, FR-003d, FR-011 |
| T024 | FR-006j, FR-008c, SC-002, SC-003a, SC-003d, SC-003f, SC-005, SC-005a, SC-005b, SC-007, SC-008c |
| T025 | 헌법 I·IV |
| T026 | FR-007a |
| T027 | FR-006b, SC-007b |
| T028 | FR-001c, FR-006k, FR-006l |

**의도적으로 코드 작업이 없는 조항**: FR-001e(판별식에 귀속 조건을 **넣지 않는다** — 부작위),
FR-002h(비율 게이트를 **두지 않는다** — 부작위), FR-005a(`heal` 을 **쓰지 않는다** — 부작위),
FR-006k(`triple_extracted` 를 **건드리지 않는다** — 부작위). 넷 다 "하지 않음"이 요구사항이므로
T028 Step 3 의 문서와 코드 리뷰가 지킨다.

---

## 실행 전략

### MVP 우선 (US1 만)

1. Phase 1 → 2 → 3 완료
2. **멈추고 검증**: dry-run 리포트를 사람이 읽는다
3. 여기서 끝내도 "무엇을 지우게 되는가"의 답은 나온다. 실행은 별도 결정이다

### 증분

1. Setup + Foundational → 기반 완료
2. US1 → dry-run 리포트 (MVP)
3. US2 → 러너 완성 + 사본 리허설 → **여기까지 코드**
4. 운영자 게이트 통과 → 라이브 실행
5. US3 → 효과 검증

### 잊지 말 것

- 매 작업 끝에 커밋한다. 커밋 전에 `git status` 로 `.local/` 산출물이 섞이지 않았는지 본다
- `[REVIEW]` 는 자동으로 통과시키지 않는다. 확인하지 않은 게이트 환경변수에 `1` 을 넣는 순간
  게이트 전체가 장식이 된다
- 라이브에서 `initializeDatabase` 를 부르지 않는다. 마이그레이션이 돈다
- 라이브에서 `memory_injection` 프로브를 돌리지 않는다. 측정이 자기충족적이 된다
- `cleanup` 없이 `vacuum` 하지 않는다. 감소량이 과소 보고된다
