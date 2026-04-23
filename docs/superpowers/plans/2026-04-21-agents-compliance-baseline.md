# AGENTS Compliance Baseline Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AGENTS.md`와 `DEVELOPMENT_RULES.md`가 요구하는 정본 구조, 신뢰 가능한 품질 게이트, 핵심 아키텍처 경계, dashboard/static 규칙을 다시 맞춘다.

**Architecture:** `packages/*`를 정본(source of truth)으로 고정하고 루트는 orchestration/publish/test entry만 담당하게 정리한다. 루트 검증 명령은 실제로 배포되는 코드 경로(`packages/*`, `apps/*`, `static/*`)를 모두 검사하도록 바꾸고, `memento-core`에는 import contract test를 추가해 아키텍처 회귀를 막는다. dashboard/static은 token-first와 no-console 규칙을 테스트와 코드 양쪽에서 고정한다.

**Tech Stack:** TypeScript 5.x, npm workspaces, Vitest, ESLint, Node.js 20+, static HTML/CSS/JS

---

## Scope

이 plan은 한 번에 전부 재작성하지 않는다. 우선순위는 다음 4단계다.

1. `packages/memento-client`를 공식 클라이언트 경로로 확정하고 `packages/mcp-client` 레거시 drift를 차단한다.
2. 루트 `lint` / `type-check` / `test`가 실제 저장소를 대표하도록 만든다.
3. `memento-core`의 대표적인 `domains -> infrastructure` 직접 의존 한 축(`relation-graph-factory`)을 끊고, 같은 종류의 회귀를 막는 contract test를 추가한다.
4. 새로 강화된 dashboard/static 규칙(token-first, `console.log` 금지)을 코드와 테스트로 고정한다.

`RetryManager`, `CacheService`, migration service까지 포함한 전체 경계 복구는 이 baseline 이후 별도 follow-up plan으로 이어간다.

## File Map

- `package.json`: 루트 scripts를 정본 workspace 기준으로 정리하고 게이트를 확장한다.
- `.eslintrc.json`: `apps/*`, `static/js/*`까지 검사 가능하도록 범위와 env를 정리한다.
- `vitest.config.ts`: root test include 범위를 실제 workspace/app 경로까지 확장한다.
- `packages/mcp-client/package.json`: 더 이상 공식 `@memento/client`를 주장하지 못하도록 레거시 표시를 한다.
- `packages/memento-server/src/cli/cli-ac5-ac6.spec.ts`: stale `dist/cli.js`에 의존하는 실패 시나리오를 재현/고정한다.
- `packages/memento-server/src/cli.ts`: CLI exit-code 동작을 source 기준으로 안정화한다.
- `packages/memento-core/src/domains/memory/tools/remember-tool.ts`: 첫 번째 boundary refactor 대상.
- `packages/memento-core/src/domains/relation/ports/relation-graph.port.ts`: relation graph 추상화 포트.
- `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`: import contract test.
- `static/js/anchor-map.js`, `static/js/graph.js`, `static/graph.html`, `static/css/components.css`, `static/css/dashboard.css`: token-first / no-console 정리 대상.
- `tests/workspace-client-paths.spec.ts`: client 정본 경로 contract test.
- `tests/root-quality-gates.spec.ts`: root gate contract test.
- `tests/static-design-contracts.spec.ts`: static token/no-console contract test.

---

### Task 1: 공식 client 경로를 `packages/memento-client`로 고정

**Files:**
- Create: `tests/workspace-client-paths.spec.ts`
- Modify: `package.json`
- Modify: `packages/mcp-client/package.json`
- Modify: `packages/mcp-client/tsconfig.build.json`
- Test: `tests/npm-publish-bin.spec.ts`

- [ ] **Step 1: 공식 client 경로 contract test 추가**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
};

function readJson(relativePath: string): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf-8')) as PackageJson;
}

describe('workspace client path contracts', () => {
  it('root client scripts should target the official @memento/client workspace', () => {
    const root = readJson('package.json');

    expect(root.scripts?.['build:client']).toBe('npm run build -w @memento/client');
    expect(root.scripts?.['dev:client']).toBe('npm run dev -w @memento/client');
    expect(root.scripts?.['clean:client']).toBe('npm run clean -w @memento/client');
    expect(root.scripts?.['publish:client']).toBe('npm publish --workspace @memento/client');
  });

  it('legacy packages/mcp-client should not claim the official package name', () => {
    const legacy = readJson('packages/mcp-client/package.json');

    expect(legacy.name).toBe('@memento/client-legacy');
    expect(legacy.private).toBe(true);
  });
});
```

- [ ] **Step 2: 새 contract test가 실패하는지 확인**

Run: `npx vitest run tests/workspace-client-paths.spec.ts tests/npm-publish-bin.spec.ts`

Expected: FAIL because `package.json` still points `build:client` / `dev:client` / `clean:client` / `publish:client` to `packages/mcp-client`, and legacy package still uses `@memento/client`.

- [ ] **Step 3: root scripts와 legacy package metadata를 최소 수정으로 정리**

```json
{
  "scripts": {
    "build:client": "npm run build -w @memento/client",
    "dev:client": "npm run dev -w @memento/client",
    "clean:client": "npm run clean -w @memento/client",
    "publish:client": "npm publish --workspace @memento/client"
  }
}
```

```json
{
  "name": "@memento/client-legacy",
  "private": true,
  "description": "Legacy client package kept only for migration reference"
}
```

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "../../src/npm-client"
  },
  "include": [
    "../../src/npm-client/**/*"
  ]
}
```

의도는 `packages/mcp-client`를 당장 삭제하는 것이 아니라, 더 이상 공식 package identity를 주장하지 못하게 하면서 루트 진입점이 모두 `packages/memento-client`를 가리키게 만드는 것이다.

- [ ] **Step 4: client 정본 경로 관련 테스트를 다시 실행**

Run: `npx vitest run tests/workspace-client-paths.spec.ts tests/npm-publish-bin.spec.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add package.json packages/mcp-client/package.json packages/mcp-client/tsconfig.build.json tests/workspace-client-paths.spec.ts tests/npm-publish-bin.spec.ts
git commit -m "chore(client): 공식 workspace 경로를 memento-client로 고정"
```

---

### Task 2: root 품질 게이트를 실제 코드 경로와 일치시키고 현재 failing CLI test를 복구

**Files:**
- Create: `tests/root-quality-gates.spec.ts`
- Create: `apps/experimental-example/src/index.spec.ts`
- Modify: `package.json`
- Modify: `.eslintrc.json`
- Modify: `vitest.config.ts`
- Modify: `packages/memento-server/src/cli/cli-ac5-ac6.spec.ts`
- Modify: `packages/memento-server/src/cli.ts`
- Modify: `apps/experimental-example/src/index.ts`
- Test: `packages/memento-server/src/server/cli-integration.spec.ts`

- [ ] **Step 1: root gate contract test 추가**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type RootPackageJson = { scripts?: Record<string, string> };

function readRootPackageJson(): RootPackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as RootPackageJson;
}

describe('root quality gate contracts', () => {
  it('lint should cover src, packages, apps, and static/js', () => {
    const pkg = readRootPackageJson();
    expect(pkg.scripts?.lint).toContain('lint:ts');
    expect(pkg.scripts?.lint).toContain('lint:js');
    expect(pkg.scripts?.['lint:ts']).toContain('{src,packages,apps,tests,scripts}');
    expect(pkg.scripts?.['lint:js']).toContain('static/js/**/*.js');
  });

  it('type-check should cover all declared workspaces', () => {
    const pkg = readRootPackageJson();
    expect(pkg.scripts?.['type-check']).toContain('@memento/core');
    expect(pkg.scripts?.['type-check']).toContain('memento-server');
    expect(pkg.scripts?.['type-check']).toContain('@memento/client');
    expect(pkg.scripts?.['type-check']).toContain('experimental-example');
  });

  it('test should build the server CLI before running vitest', () => {
    const pkg = readRootPackageJson();
    expect(pkg.scripts?.['test:prepare']).toBe('npm run build -w memento-server');
    expect(pkg.scripts?.test).toBe('npm run test:prepare && vitest --run');
  });
});
```

- [ ] **Step 2: 현재 failing CLI test를 먼저 재현**

Run: `npx vitest run packages/memento-server/src/cli/cli-ac5-ac6.spec.ts`

Expected: FAIL on AC5 / AC6 if the spec is still reading stale `dist/cli.js` or if the CLI source/dist contract has drifted.

- [ ] **Step 3: root scripts와 ESLint 범위를 정리**

```json
{
  "scripts": {
    "test:prepare": "npm run build -w memento-server",
    "test": "npm run test:prepare && vitest --run",
    "lint": "npm run lint:ts && npm run lint:js",
    "lint:ts": "eslint \"{src,packages,apps,tests,scripts}/**/*.ts\"",
    "lint:js": "eslint \"static/js/**/*.js\"",
    "type-check": "npm run type-check -w @memento/core && npm run type-check -w memento-server && npm run type-check -w @memento/client && npm run type-check -w experimental-example"
  }
}
```

```json
{
  "overrides": [
    {
      "files": ["static/**/*.js"],
      "env": {
        "browser": true,
        "node": false,
        "es2022": true
      },
      "rules": {
        "no-console": "error"
      }
    },
    {
      "files": ["apps/**/*.ts"],
      "rules": {
        "no-console": "error"
      }
    }
  ],
  "ignorePatterns": [
    "dist/",
    "node_modules/"
  ]
}
```

```ts
// vitest.config.ts include excerpt
include: [
  'src/npm-client/**/*.{test,spec}.{js,ts}',
  'src/services/**/*.{test,spec}.{js,ts}',
  'src/test/**/*.{test,spec}.{js,ts}',
  'src/tools/**/*.{test,spec}.{js,ts}',
  'src/workers/**/*.{test,spec}.{js,ts}',
  'tests/**/*.{test,spec}.{js,ts}',
  'scripts/**/*.{test,spec}.{js,ts}',
  'apps/**/*.{test,spec}.{js,ts}',
  'packages/memento-core/src/**/*.{test,spec}.{js,ts}',
  'packages/memento-client/src/**/*.{test,spec}.{js,ts}',
  'packages/memento-server/src/**/*.{test,spec}.{js,ts}'
]
```

- [ ] **Step 4: experimental example을 테스트 가능한 구조로 바꾼다**

```ts
// apps/experimental-example/src/index.ts
export async function runExample(dbPath: string): Promise<number> {
  const { db, services } = await createMementoCore({ dbPath });
  const context = createToolContext(db, services);
  const registry = getToolRegistry();

  try {
    await registry.execute('remember', {
      content: 'experimental-example에서 저장한 테스트 기억',
      type: 'episodic',
      tags: ['experimental-example', 'demo'],
    }, context);

    await registry.execute('recall', { query: 'experimental-example', limit: 5 }, context);
    return 0;
  } finally {
    await services.runtimeDiagnosticsSamplerCleanup?.();
    closeDatabase(db);
  }
}

export async function main(): Promise<void> {
  const code = await runExample(process.env.DB_PATH ?? ':memory:');
  process.exit(code);
}
```

이 변경 후 `apps/experimental-example/src/index.spec.ts`를 추가해 `runExample(':memory:')`가 `0`을 반환하는 smoke test를 작성한다.

- [ ] **Step 5: CLI spec이 source 동작을 정확히 검증하도록 안정화**

```ts
// packages/memento-server/src/cli/cli-ac5-ac6.spec.ts
beforeAll(() => {
  const build = spawnSync('npm', ['run', 'build', '-w', 'memento-server'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  expect(build.status).toBe(0);
});
```

```ts
// packages/memento-server/src/cli.ts
if (!serverInfo || !serverAlive) {
  if (serverInfo && !serverAlive) {
    await deleteServerInfo(configDir);
  }
  await writeStderr(
    'Memento 서버가 실행 중이지 않습니다.\n' +
    'npm run dev 또는 npm run dev:http 로 먼저 서버를 실행하세요.\n'
  );
  return 1;
}
```

핵심은 root `npm test`가 stale `dist` 때문에 거짓 실패/거짓 성공을 만들지 않게 하는 것이다.

- [ ] **Step 6: 품질 게이트 관련 검증을 순서대로 실행**

Run:
- `npx vitest run tests/root-quality-gates.spec.ts`
- `npx vitest run packages/memento-server/src/cli/cli-ac5-ac6.spec.ts packages/memento-server/src/server/cli-integration.spec.ts`
- `npm run lint`
- `npm run type-check`
- `npm test`

Expected: all PASS.

- [ ] **Step 7: 커밋**

```bash
git add package.json .eslintrc.json vitest.config.ts tests/root-quality-gates.spec.ts packages/memento-server/src/cli/cli-ac5-ac6.spec.ts packages/memento-server/src/cli.ts apps/experimental-example/src/index.ts apps/experimental-example/src/index.spec.ts
git commit -m "test(gates): 루트 검증 게이트를 실제 workspace 기준으로 정렬"
```

---

### Task 3: `relation-graph-factory` 직접 의존을 끊고 boundary contract test 추가

**Files:**
- Create: `packages/memento-core/src/domains/relation/ports/relation-graph.port.ts`
- Create: `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`
- Modify: `packages/memento-core/src/domains/memory/tools/remember-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/add-relation-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/get-relations-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/remove-relation-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/extract-relations-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/visualize-relations-tool.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`
- Test: `packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts`

- [ ] **Step 1: 특정 import 패턴을 막는 failing contract test 작성**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

describe('dependency boundaries', () => {
  it('domain production files should not import relation-graph-factory directly', () => {
    const offenders = globSync('packages/memento-core/src/domains/**/*.ts')
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => readFileSync(join(process.cwd(), file), 'utf-8').includes('infrastructure/relation-graph-factory.js'));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: contract test가 실패하는지 확인**

Run: `npx vitest run packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`

Expected: FAIL with a list including `remember-tool.ts` and relation tool files.

- [ ] **Step 3: relation graph 포트를 domain 레이어에 만든다**

```ts
// packages/memento-core/src/domains/relation/ports/relation-graph.port.ts
import type { MemoryItem } from '../../../shared/types/index.js';

export interface RelationGraphPort {
  addMemory(memory: MemoryItem): Promise<void>;
  addRelation(sourceId: string, targetId: string, relationType: string): Promise<void>;
  getRelations(memoryId: string): Promise<unknown[]>;
  removeRelation(sourceId: string, targetId: string, relationType: string): Promise<void>;
}
```

- [ ] **Step 4: domain 도구들이 factory 대신 포트를 주입받도록 바꾼다**

```ts
// remember-tool.ts excerpt
import type { RelationGraphPort } from '../../relation/ports/relation-graph.port.js';

export class RememberTool extends BaseTool {
  constructor(
    db: Database.Database,
    private readonly relationGraph: RelationGraphPort,
  ) {
    super(db);
  }
}
```

```ts
// packages/memento-core/src/bootstrap.ts excerpt
import { createRelationGraph } from './infrastructure/relation-graph-factory.js';

const relationGraph = createRelationGraph(db);
const rememberTool = new RememberTool(db, relationGraph);
```

첫 번째 slice에서는 `relation-graph-factory` 직접 import만 제거한다. `RetryManager`, `CacheService`, migration service 의존은 후속 slice로 남긴다.

- [ ] **Step 5: boundary contract와 관련 unit test를 다시 실행**

Run:
- `npx vitest run packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`
- `npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts`
- `npx vitest run packages/memento-core/src/domains/relation/tools/__tests__/add-relation-tool.spec.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/memento-core/src/domains/relation/ports/relation-graph.port.ts packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts packages/memento-core/src/bootstrap.ts packages/memento-core/src/domains/memory/tools/remember-tool.ts packages/memento-core/src/domains/relation/tools/*.ts
git commit -m "refactor(core): relation graph 의존성을 domain port로 분리"
```

---

### Task 4: dashboard/static을 token-first + no-console 규칙에 맞춘다

**Files:**
- Create: `tests/static-design-contracts.spec.ts`
- Modify: `static/js/anchor-map.js`
- Modify: `static/js/graph.js`
- Modify: `static/graph.html`
- Modify: `static/css/components.css`
- Modify: `static/css/dashboard.css`
- Modify: `static/css/tokens.css`
- Test: `tests/anchor-map-search-highlight.spec.ts`

- [ ] **Step 1: static contract test 작성**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf-8');
}

describe('static design contracts', () => {
  it('anchor-map.js should not use console APIs directly', () => {
    expect(read('static/js/anchor-map.js')).not.toMatch(/console\./);
  });

  it('graph.js should read colors from CSS tokens instead of hard-coded hex values', () => {
    const source = read('static/js/graph.js');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('graph.html should not ship inline color styles', () => {
    const source = read('static/graph.html');
    expect(source).not.toMatch(/style=\"[^\"]*(color|background)\s*:/);
  });
});
```

- [ ] **Step 2: contract test가 실패하는지 확인**

Run: `npx vitest run tests/static-design-contracts.spec.ts tests/anchor-map-search-highlight.spec.ts`

Expected: FAIL because `anchor-map.js` still contains direct `console.*` calls, `graph.js` contains hard-coded hex colors, and `graph.html` still ships inline legend/button styles.

- [ ] **Step 3: tokens를 먼저 확장하고 CSS/HTML/JS를 그 토큰으로 치환**

```css
/* static/css/tokens.css */
:root {
  --color-graph-header-bg: #1a1d2e;
  --color-graph-accent: #a78bfa;
  --color-graph-muted: #94a3b8;
  --color-tab-bg: #e8eaf6;
  --color-tab-border: #c5cae9;
}
```

```css
/* static/css/dashboard.css */
.m-tab-bar {
  background: var(--color-tab-bg);
  border-bottom: 1px solid var(--color-tab-border);
}

.m-tab-btn.active {
  border-color: var(--color-tab-border);
}
```

```html
<!-- static/graph.html -->
<div class="legend-item legend-item--episodic"><span class="legend-dot"></span>Episodic</div>
<div class="legend-item legend-item--semantic"><span class="legend-dot"></span>Semantic</div>
<div class="legend-item legend-item--procedural"><span class="legend-dot"></span>Procedural</div>
<div class="legend-item legend-item--working"><span class="legend-dot"></span>Working</div>
```

```js
// static/js/graph.js
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const NODE_COLORS = {
  episodic: token('--color-memory-episodic'),
  semantic: token('--color-memory-semantic'),
  procedural: token('--color-memory-procedural'),
  working: token('--color-memory-working'),
};
```

- [ ] **Step 4: `console.log`를 제거하고 UI-safe debug helper로 교체**

```js
function debugLog(eventName, detail) {
  if (window.localStorage.getItem('memento.debug') === '1') {
    document.body?.dispatchEvent(
      new CustomEvent('memento:debug', { detail: { eventName, detail } })
    );
  }
}
```

```js
if (hasChanged) {
  debugLog('map updated', newMapData.timestamp);
} else {
  debugLog('map unchanged');
}
```

직접 `console.*`를 남기지 말고, 사용자가 명시적으로 debug flag를 켰을 때만 DOM custom event를 내보내는 helper를 사용한다.

- [ ] **Step 5: static contract와 관련 UI test를 재실행**

Run:
- `npx vitest run tests/static-design-contracts.spec.ts tests/anchor-map-search-highlight.spec.ts`
- `npm run lint:js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add tests/static-design-contracts.spec.ts static/js/anchor-map.js static/js/graph.js static/graph.html static/css/components.css static/css/dashboard.css static/css/tokens.css
git commit -m "refactor(ui): dashboard static 자산을 token-first 규칙으로 정렬"
```

---

## Self-Review

- **Spec coverage:** 이 plan은 감사에서 확인된 4개 축(구조 drift, 거짓 품질 게이트, 대표 boundary 위반, static 규칙 미준수)을 각각 task로 대응한다.
- **Placeholder scan:** `TODO`, `TBD`, “적절한 처리 추가” 같은 문구 없이 실제 파일/명령/코드 예시를 넣었다.
- **Type consistency:** 공식 client package는 `@memento/client`, legacy package는 `@memento/client-legacy`로 일관되게 사용했다. boundary slice는 `RelationGraphPort`라는 단일 이름으로 고정했다.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-agents-compliance-baseline.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
