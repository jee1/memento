# Developer Continuity Assistant Phase 1 Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 코드 리뷰에서 지적된 배포·패키징·CLI 계약·품질 게이트 문제를 해결해 Phase 1 continuity 기능을 문서대로 설치하고 실행 가능한 상태로 hardening 한다.

**Architecture:** 루트 패키지는 continuity CLI의 사용자-facing distribution boundary를 맡고, `packages/memento-assistant`는 continuity 기능의 product boundary를 유지한다. 구현은 `루트 배포 경계 복구`, `assistant public API/런타임 dependency 정비`, `CLI 계약 정렬`, `workspace-aware quality gate`의 네 축으로 나눈다.

**Tech Stack:** TypeScript, npm workspaces, Node.js ESM, Vitest, existing root build/publish scripts, `npm pack --dry-run`.

---

### Task 1: 루트 배포 경계에 continuity CLI 포함

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-bin.js`
- Test: `scripts/verify-bin.js`

**Step 1: Write the failing validation**

루트 패키지가 continuity CLI를 배포 경계에 포함하지 못하는 상태를 재현하는 검증을 먼저 고정한다.

Run:

```bash
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

Expected: tarball 목록에 `memento-continuity`가 가리키는 assistant dist 경로가 없거나, root `bin`에 continuity entry가 없어 리뷰 지적 상태를 재현한다.

**Step 2: Run targeted precondition check**

Run:

```bash
node scripts/verify-bin.js
```

Expected: 현재 root `bin` 기준으로는 continuity CLI 검증이 수행되지 않는다.

**Step 3: Write minimal implementation**

아래 변경을 적용한다.

- 루트 `package.json`의 `bin`에 `memento-continuity` 추가
- 루트 `build`에 assistant build 포함
- 루트 `files`에 `packages/memento-assistant/dist` 포함
- 필요하면 `prepublishOnly` 흐름이 continuity entry까지 검증하도록 `scripts/verify-bin.js` 보강

핵심 기준:

- root publish 산출물만으로 `memento-continuity` 실행 파일이 tarball에 들어가야 한다.
- root 배포 경계는 assistant product boundary를 대체하지 않고, 단지 사용자-facing entry를 제공한다.

**Step 4: Run validation to verify it passes**

Run:

```bash
npm run build
```

Expected: root build와 assistant build가 모두 성공하고, continuity CLI 대상 파일이 생성된다.

**Step 5: Verify the tarball contract**

Run:

```bash
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

Expected: tarball 목록에 `packages/memento-assistant/dist/client/continuity-cli.js`가 포함된다. 실제 구현 결과가 다른 단일 경로로 확정되면 설계 문서와 이 항목을 함께 갱신한다.

**Step 6: Commit**

```bash
git add package.json scripts/verify-bin.js
git commit -m "fix: include continuity cli in root distribution"
```

---

### Task 2: assistant package root export와 runtime dependency 정리

**Files:**
- Modify: `packages/memento-assistant/src/index.ts`
- Modify: `packages/memento-assistant/package.json`
- Modify: `packages/memento-core/src/index.ts`
- Test: `packages/memento-assistant/src/client/assistant-client.spec.ts`

**Step 1: Write the failing test**

assistant package root에서 public API가 보이지 않는 문제를 재현하는 스펙을 추가하거나 기존 스펙을 확장한다.

예시 검증 포인트:

- `packages/memento-assistant/src/index.ts`가 `AssistantClient`를 재export하는가
- continuity 관련 public type이 root entry에서 노출되는가

가능하면 `packages/memento-assistant/src/client/assistant-client.spec.ts` 또는 새 root export 스펙으로 아래 형태를 고정한다.

```ts
import * as assistant from '../index.js';
import { expect, it } from 'vitest';

it('re-exports assistant public api from package root', () => {
  expect(assistant.AssistantClient).toBeDefined();
  expect(assistant.runCli).toBeTypeOf('function');
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/assistant-client.spec.ts
```

Expected: root entry 재export 부재 또는 관련 assertion 실패.

**Step 3: Write minimal implementation**

아래 기준으로 정리한다.

- `packages/memento-assistant/src/index.ts`에서 `./client/index.js` 및 필요한 continuity 타입 재export
- `packages/memento-assistant/package.json`에 최소 `zod` runtime dependency 추가
- `packages/memento-assistant/package.json`의 entry metadata(`main`, `types`, 필요 시 `exports`)를 root surface 기준으로 검토
- `packages/memento-core/src/index.ts`는 이번 hardening 범위에서 변경하지 않거나, export 정합성 때문에 필요할 때만 최소 facade 수준으로 유지한다. hardening 범위의 중심은 assistant 쪽 공개 surface 복구다.

**Step 4: Run package-level checks**

Run:

```bash
npm run --workspace packages/memento-assistant type-check
```

Expected: assistant package가 자체 dependency 선언과 root entry 기준으로 타입 검사를 통과한다.

**Step 5: Run regression test**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/assistant-client.spec.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/memento-assistant/src/index.ts packages/memento-assistant/package.json packages/memento-core/src/index.ts
git commit -m "fix: expose assistant public api from package root"
```

---

### Task 3: CLI 옵션 계약을 구현과 문서에서 통일

**Files:**
- Modify: `packages/memento-assistant/src/client/continuity-cli.ts`
- Modify: `packages/memento-assistant/src/client/continuity-cli.spec.ts`
- Modify: `docs/guides/ko/developer-continuity-assistant-phase1.md`

**Step 1: Write the failing test**

CLI가 `--process`와 `--process_id`를 같은 의미로 처리해야 한다는 스펙을 먼저 고정한다.

예시:

```ts
it('accepts both --process and --process_id aliases', async () => {
  // 동일한 client 호출 payload로 정규화되는지 검증
});
```

`packages/memento-assistant/src/client/continuity-cli.spec.ts`에서 아래 케이스를 추가한다.

- `resume --process cursor`
- `resume --process_id cursor`
- 두 호출이 모두 `process_id: 'cursor'`로 정규화되는가

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/continuity-cli.spec.ts
```

Expected: `--process` 입력이 무시되거나 기대 payload와 달라 FAIL.

**Step 3: Write minimal implementation**

`parseArgs()` 또는 command payload 생성 단계에서 alias 정규화를 추가한다.

권장 규칙:

- `process_id = options.process_id ?? options.process`
- 문서 표준 옵션은 `--process`
- 기존 `--process_id`도 하위 호환으로 유지

문서는 `--process`를 표준 예시로 통일하되, 필요하면 호환 별칭이 있다는 한 줄을 남긴다.

**Step 4: Run test to verify it passes**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/continuity-cli.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/memento-assistant/src/client/continuity-cli.ts packages/memento-assistant/src/client/continuity-cli.spec.ts docs/guides/ko/developer-continuity-assistant-phase1.md
git commit -m "fix: align continuity cli option contract"
```

---

### Task 4: 루트 품질 게이트를 workspace-aware 하게 전환

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `packages/memento-assistant/package.json`
- Modify: `packages/memento-core/package.json`
- Test: `scripts/validate-workspace.mjs`

**Step 1: Write the failing validation**

루트 `type-check`가 packages를 실제로 검사하지 않는 상태를 고정한다.

Run:

```bash
npm run type-check
```

Expected: 현재는 root `src/**/*`만 검사하고, package-level type-check가 빠져 있다.

**Step 2: Define the target gate**

목표 게이트는 아래를 모두 실행하는 것이다.

- `npm run validate:workspace`
- root `tsc --noEmit`
- `npm run --workspace packages/memento-core type-check`
- `npm run --workspace packages/memento-assistant type-check`

필요 시 root `build`에도 동일한 방향으로 workspace build를 반영한다.

**Step 3: Write minimal implementation**

아래 원칙으로 루트 스크립트를 수정한다.

- 루트 `type-check`는 workspace별 `type-check`까지 호출
- root `tsconfig.json`은 계속 root source만 담당하되, workspace coverage는 script orchestration으로 해결
- `packages/memento-core/package.json`, `packages/memento-assistant/package.json`의 `type-check` 스크립트가 일관되게 동작하도록 정리

**Step 4: Run workspace gate**

Run:

```bash
npm run type-check
```

Expected: root와 두 workspace package가 모두 검사된다.

**Step 5: Commit**

```bash
git add package.json tsconfig.json packages/memento-core/package.json packages/memento-assistant/package.json
git commit -m "chore: make root quality gates workspace aware"
```

---

### Task 5: hardening 회귀 검증과 문서 마무리

**Files:**
- Modify: `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-design.md`
- Modify: `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md`
- Test: `package.json`

**Step 1: Run targeted assistant regression suite**

Run:

```bash
npx vitest --run \
  packages/memento-assistant/src/client/assistant-client.spec.ts \
  packages/memento-assistant/src/client/continuity-cli.spec.ts \
  packages/memento-assistant/src/server/assistant-http-server.spec.ts \
  packages/memento-assistant/src/continuity/tool-registry.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/start-session-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/save-context-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts
```

Expected: PASS.

**Step 2: Run publish-shape regression**

Run:

```bash
npm run build
npm_config_cache=/tmp/npm-cache npm pack --dry-run
node scripts/verify-bin.js
```

Expected:

- build PASS
- tarball에 continuity 산출물 포함
- verify-bin PASS

**Step 3: Update hardening docs with evidence**

기록할 항목:

- 어떤 files/bin/scripts를 바꿨는지
- 어떤 명령으로 검증했는지
- review finding 5개 중 어떤 항목이 어떤 변경으로 닫혔는지
- 설계 문서 상단의 상태 필드를 계속 `디자인 승인`으로 둘지, `구현 완료` 같은 후속 상태값으로 갱신할지 결정하고 반영했는지

**Step 4: Commit**

```bash
git add docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-design.md docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md
git commit -m "docs: capture continuity hardening design and plan"
```

---

## 검증 결과 (Evidence, 2026-03)

**변경된 files/bin/scripts:**
- 루트 `package.json`: `bin.memento-continuity`, `build`(assistant workspace 포함), `files`(packages/memento-assistant/dist), `type-check`(workspace type-check 연쇄)
- `packages/memento-assistant`: `src/index.ts` 재export, `package.json` zod, `src/client/continuity-cli.ts` 옵션 정규화, shebang, tsconfig/assistant-http-server 타입
- `docs/guides/ko/developer-continuity-assistant-phase1.md`: `--process` 표준 및 `--process_id` 별칭 문구

**검증 명령 및 결과:**
- `npm run build` → 성공 (root + assistant)
- `npm run type-check` → 성공 (validate:workspace, root tsc, memento-core type-check, memento-assistant type-check)
- `node scripts/verify-bin.js` → 모든 bin(含 memento-continuity) 검증 완료
- `npm_config_cache=/tmp/npm-cache npm pack --dry-run` → tarball에 `packages/memento-assistant/dist/client/continuity-cli.js` 포함
- assistant 회귀 스위트 11파일 14테스트 → PASS

**리뷰 finding 5개 대응:** 설계 문서 §6 구현 결과 표 참조. 상태는 `디자인 승인` → `구현 완료`로 갱신.

---

Plan complete and saved to `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
