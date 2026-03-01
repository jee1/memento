# Memento Developer Continuity Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 같은 저장소 안에서 `memento-core`와 `memento-assistant`를 분리한 뒤, `memento-assistant`가 `memento-core`의 공개 API를 사용해 Phase 1용 `developer continuity assistant`를 구현하도록 만든다.

**Architecture:** 루트 저장소는 멀티패키지 구조를 사용하고, `packages/memento-core`는 범용 메모리 플랫폼, `packages/memento-assistant`는 개인비서 제품 계층으로 분리한다. `assistant`는 `core`의 공개 API, MCP/HTTP tools, 범용 client만 사용하고, `core`는 `assistant`를 전혀 참조하지 않는다. Phase 1에서는 `packages/memento-core`는 엔트리포인트와 공개 계약을 먼저 담당하고, 기존 구현(`src/domains`, `src/server`, `src/tools`, `src/shared`, `src/npm-client`)은 루트 `src/`에 유지한다. 즉, package 경계를 먼저 세우고 실제 core 코드 이동은 후속 Phase에서 수행한다. IDE 패널 자체는 후속 작업으로 두고, 이번 Phase 1에서는 `assistant`가 소비할 `resume snapshot` 계약과 CLI 중심 continuity 흐름까지만 구현한다.

**Tech Stack:** TypeScript, workspace/multi-package layout, existing MCP tool registry, Express `/tools/*` HTTP façade, npm client, Vitest, `tsx`.

---

## Task 0: core/assistant package 경계와 workspace 구조 수립

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `packages/memento-core/package.json`
- Create: `packages/memento-assistant/package.json`
- Create: `packages/memento-core/tsconfig.json`
- Create: `packages/memento-assistant/tsconfig.json`
- Create: `packages/memento-core/src/index.ts`
- Create: `packages/memento-assistant/src/index.ts`

**Step 1: Write the failing validation**

workspace 구조와 패키지 엔트리포인트를 먼저 검증한다.

- 루트 `package.json`에 workspace 설정이 없으면 FAIL
- `packages/memento-core`와 `packages/memento-assistant`가 없으면 FAIL
- 각 패키지의 `src/index.ts`가 없으면 FAIL

간단한 검증 스크립트나 type-check만으로도 충분하다.

**Step 2: Run validation to verify it fails**

Run:

```bash
npm run type-check
```

Expected: FAIL until package 구조와 tsconfig가 정리된다.

**Step 3: Write minimal implementation**

루트는 workspace를 인식하게 하고, 두 package를 만든다.

예시:

```json
{
  "workspaces": [
    "packages/memento-core",
    "packages/memento-assistant"
  ]
}
```

핵심 원칙:

- `packages/memento-core`
  - 범용 메모리 플랫폼
  - remember/recall/anchor/relation/search/client의 공개 엔트리 제공
- `packages/memento-assistant`
  - continuity, session lifecycle, resume snapshot, assistant CLI 담당
- 의존 방향:
  - `memento-assistant -> memento-core`
  - `memento-core -> memento-assistant` 금지

초기 단계에서는 기존 코드를 즉시 전부 이동하지 않아도 된다. 우선 package 경계와 엔트리포인트를 만들고, 후속 Task에서 assistant 전용 코드를 `packages/memento-assistant` 아래에 추가한다.

Phase 1에서 `packages/memento-core`는 facade 역할을 우선 맡는다. 즉, 기존 core 구현은 루트 `src/`에 남겨 두고, `packages/memento-core/src/index.ts`가 공개 계약과 엔트리포인트를 제공한다.

**Step 4: Run validation to verify it passes**

Run:

```bash
npm run type-check
```

Expected: PASS. Workspace와 package 엔트리포인트가 유효해야 한다.

**Step 5: Commit**

```bash
git add package.json tsconfig.json packages/memento-core packages/memento-assistant
git commit -m "chore: establish core and assistant package boundaries"
```

---

## Task 1: core 공개 계약과 연속성 메타데이터 타입 정리

**Files:**
- Modify: `packages/memento-core/src/index.ts`
- Modify: `src/shared/types/index.ts`
- Modify: `src/npm-client/types.ts`
- Create: `packages/memento-assistant/src/continuity/types.ts`
- Create: `packages/memento-assistant/src/continuity/services/continuity-metadata.ts`
- Create: `packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts`

**Step 1: Write the failing test**

`packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts`를 만들고 아래 시나리오를 먼저 고정한다.

```ts
import { describe, expect, it } from 'vitest';
import {
  buildContinuityTags,
  buildOriginSource,
  parseOriginSource,
} from '../continuity-metadata.js';

describe('continuity-metadata', () => {
  it('task/decision/blocker/next-step 태그를 중복 없이 정규화한다', () => {
    expect(
      buildContinuityTags(['task', 'next-step', 'task'], ['continuity', 'resume'])
    ).toEqual(['continuity', 'resume', 'task', 'next-step']);
  });

  it('project/branch/session/file 정보를 origin_source JSON으로 직렬화한다', () => {
    const encoded = buildOriginSource({
      project: 'memento',
      branch: 'feature/resume',
      session_id: 'sess-1',
      files: ['src/server/index.ts'],
    });

    expect(parseOriginSource(encoded)).toMatchObject({
      project: 'memento',
      branch: 'feature/resume',
      session_id: 'sess-1',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts
```

Expected: FAIL with missing file or missing exported functions.

**Step 3: Write minimal implementation**

`packages/memento-assistant/src/continuity/types.ts`에는 Phase 1 계약을 먼저 고정한다.

```ts
export interface ContinuityArtifactLink {
  kind: 'project' | 'branch' | 'commit' | 'file' | 'issue';
  value: string;
}

export interface ContinuityOriginSource {
  project?: string;
  branch?: string;
  commit?: string;
  files?: string[];
  issue?: string;
  session_id?: string;
}

export interface ResumeCard {
  title: string;
  summary: string;
  memoryIds: string[];
}

export interface ResumeSnapshot {
  project: string;
  sessionId?: string;
  resume: ResumeCard[];
  recentDecisions: ResumeCard[];
  openThreads: ResumeCard[];
  nextActions: ResumeCard[];
}
```

`packages/memento-assistant/src/continuity/services/continuity-metadata.ts`에는 최소한 아래 함수를 구현한다.

```ts
export function buildContinuityTags(primary: string[], base: string[] = []): string[] {
  return [...new Set([...base, ...primary])];
}

export function buildOriginSource(input: ContinuityOriginSource): string {
  return JSON.stringify(input);
}

export function parseOriginSource(raw?: string | null): ContinuityOriginSource {
  if (!raw) return {};
  return JSON.parse(raw) as ContinuityOriginSource;
}
```

`src/shared/types/index.ts`와 `src/npm-client/types.ts`에는 아래 continuity 필드를 추가한다.

```ts
process_id?: string;
session_id?: string;
source_session_id?: string;
origin_source?: string;
```

여기서 `memento-core`가 노출하는 continuity 관련 타입은 `remember-tool.ts`의 Zod 스키마를 기준으로 맞춘다. 즉, shared 타입이 서버 도구 스키마와 어긋나지 않도록 `RememberSchema`에 이미 존재하는 `process_id`, `session_id`, `origin_source` 계열 필드와 동일한 이름을 사용한다.

또한 `packages/memento-core/src/index.ts`에는 assistant가 사용할 최소 공개 계약만 재노출한다.

- 공통 memory 타입
- remember/recall 관련 파라미터 타입
- 범용 client 진입점
- assistant가 호출할 core MCP/HTTP tool contract

**Step 4: Run test to verify it passes**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts
npm run type-check
```

Expected: PASS and no TypeScript errors.

**Step 5: Commit**

```bash
git add packages/memento-core/src/index.ts packages/memento-assistant/src/continuity/types.ts packages/memento-assistant/src/continuity/services/continuity-metadata.ts packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts src/shared/types/index.ts src/npm-client/types.ts
git commit -m "feat: add continuity metadata contracts"
```

---

## Task 2: assistant resume 스냅샷과 세션 체크포인트 서비스 구현

**Files:**
- Create: `packages/memento-assistant/src/continuity/services/resume-snapshot-service.ts`
- Create: `packages/memento-assistant/src/continuity/services/session-checkpoint-service.ts`
- Create: `packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts`
- Create: `packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts`
- Test: `src/domains/memory/tools/__tests__/remember-tool.spec.ts`
- Test: `src/domains/memory/tools/__tests__/recall-tool.spec.ts`

**Step 1: Write the failing tests**

`packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts`에는 `Resume / Recent Decisions / Open Threads / Next Actions` 4개 섹션을 만드는 규칙을 먼저 고정한다.

```ts
it('session_id, process_id, continuity tags를 기준으로 resume snapshot을 구성한다', async () => {
  const service = new ResumeSnapshotService(db, hybridSearchEngine);
  const snapshot = await service.build({
    project: 'memento',
    processId: 'cursor',
    sessionId: 'sess-1',
    branch: 'feature/resume',
  });

  expect(snapshot.resume.length).toBeGreaterThan(0);
  expect(snapshot.recentDecisions[0]?.title).toContain('decision');
  expect(snapshot.nextActions[0]?.summary).toContain('next');
});
```

`packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts`에는 명시적 컨텍스트 저장이 `working` 또는 `episodic` 기억으로 직렬화되는 규칙을 고정한다.

```ts
it('save checkpoint는 continuity tags와 origin_source를 포함해 memory payload를 만든다', async () => {
  const payload = service.buildCheckpointPayload({
    kind: 'decision',
    content: 'resume 엔진은 recall 기반으로 간다',
    project: 'memento',
    sessionId: 'sess-1',
    processId: 'cursor',
    branch: 'feature/resume',
  });

  expect(payload.tags).toContain('decision');
  expect(payload.session_id).toBe('sess-1');
  expect(payload.origin_source).toContain('feature/resume');
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts
```

Expected: FAIL with missing services.

**Step 3: Write minimal implementation**

`packages/memento-assistant/src/continuity/services/resume-snapshot-service.ts`는 assistant 내부 읽기 모델이다. 기존 `RecallTool`의 필터링 규칙을 그대로 재구현하지 말고, `memento-core`가 공개한 client/tool contract와 continuity 태그를 조합해 얇은 read model만 만든다.

`queryContinuityMemories`는 최소한 `tags`에 `continuity`가 포함된 항목만 대상으로 하고, `project`는 `origin_source` 메타 또는 프로젝트 관련 태그로 좁히며, `process_id`와 `session_id`는 전달된 경우 우선 필터로 사용한다. 즉, 기본 검색 축은 `continuity tag + project + optional process/session` 조합으로 둔다.

```ts
export class ResumeSnapshotService {
  async build(input: {
    project: string;
    processId?: string;
    sessionId?: string;
    branch?: string;
  }): Promise<ResumeSnapshot> {
    const items = await this.queryContinuityMemories(input);
    return {
      project: input.project,
      sessionId: input.sessionId,
      resume: this.pick(items, 'task'),
      recentDecisions: this.pick(items, 'decision'),
      openThreads: this.pick(items, 'blocker'),
      nextActions: this.pick(items, 'next-step'),
    };
  }
}
```

`packages/memento-assistant/src/continuity/services/session-checkpoint-service.ts`는 continuity 규약을 기존 `remember` payload로 변환하는 순수 서비스로 둔다.

```ts
export class SessionCheckpointService {
  buildCheckpointPayload(input: {
    kind: 'task' | 'decision' | 'blocker' | 'next-step';
    content: string;
    project: string;
    sessionId: string;
    processId?: string;
    branch?: string;
  }): RememberParams {
    return {
      content: input.content,
      type: input.kind === 'task' ? 'working' : 'episodic',
      tags: buildContinuityTags([input.kind], ['continuity']),
      process_id: input.processId,
      session_id: input.sessionId,
      origin_source: buildOriginSource({
        project: input.project,
        branch: input.branch,
        session_id: input.sessionId,
      }),
    };
  }
}
```

실제 저장 경로는 별도 repository 직접 호출이 아니라, `SessionCheckpointService.buildCheckpointPayload()`로 만든 payload를 `memento-core`가 공개한 remember tool/client 경로에 전달하는 방식으로 둔다. 이렇게 하면 현재 `remember` 도구의 검증, 관계 추출, 메타데이터 처리 경로를 그대로 재사용할 수 있다.

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts
npx vitest --run src/domains/memory/tools/__tests__/remember-tool.spec.ts src/domains/memory/tools/__tests__/recall-tool.spec.ts
```

Expected: PASS. Existing remember/recall tests must remain green.

**Step 5: Commit**

```bash
git add packages/memento-assistant/src/continuity/services/resume-snapshot-service.ts packages/memento-assistant/src/continuity/services/session-checkpoint-service.ts packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts
git commit -m "feat: add continuity resume and checkpoint services"
```

---

## Task 3: assistant continuity 도구와 assistant 전용 runtime 추가

**Files:**
- Create: `packages/memento-assistant/src/continuity/tools/start-session-tool.ts`
- Create: `packages/memento-assistant/src/continuity/tools/save-context-tool.ts`
- Create: `packages/memento-assistant/src/continuity/tools/end-session-tool.ts`
- Create: `packages/memento-assistant/src/continuity/tools/resume-session-tool.ts`
- Create: `packages/memento-assistant/src/continuity/tools/__tests__/start-session-tool.spec.ts`
- Create: `packages/memento-assistant/src/continuity/tools/__tests__/save-context-tool.spec.ts`
- Create: `packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts`
- Create: `packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts`
- Create: `packages/memento-assistant/src/continuity/tool-registry.ts`
- Create: `packages/memento-assistant/src/continuity/tool-registry.spec.ts`
- Create: `packages/memento-assistant/src/server/assistant-http-server.ts`
- Create: `packages/memento-assistant/src/server/assistant-http-server.spec.ts`

**Step 1: Write the failing tests**

각 도구의 contract를 먼저 고정한다.

```ts
it('start_session should create a working memory checkpoint and return session metadata', async () => {
  const result = await tool.handler({
    project: 'memento',
    process_id: 'cursor',
    session_id: 'sess-1',
    branch: 'feature/resume',
  }, context);

  expect(result.session_id).toBe('sess-1');
  expect(result.memory_id).toBeDefined();
});

it('resume_session should return Resume/Recent Decisions/Open Threads/Next Actions sections', async () => {
  const result = await tool.handler({
    project: 'memento',
    process_id: 'cursor',
    session_id: 'sess-1',
  }, context);

  expect(result.snapshot).toHaveProperty('resume');
  expect(result.snapshot).toHaveProperty('recentDecisions');
});
```

`packages/memento-assistant/src/continuity/tool-registry.spec.ts`에는 continuity 도구들이 assistant registry에 등록되는지 확인하는 테스트를 추가한다.

`packages/memento-assistant/src/server/assistant-http-server.spec.ts`에는 assistant runtime이 assistant registry를 `/assistant/tools/*` 경로로 노출하는지 검증하는 테스트를 추가한다.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/tools/__tests__/start-session-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/save-context-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts packages/memento-assistant/src/continuity/tool-registry.spec.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
```

Expected: FAIL with missing tool files and assistant registry entries.

**Step 3: Write minimal implementation**

도구는 기존 `BaseTool` 패턴을 그대로 따른다.

```ts
export class ResumeSessionTool extends BaseTool {
  async handle(params: ResumeSessionParams, context: ToolContext): Promise<ToolResult> {
    const snapshot = await this.resumeSnapshotService.build({
      project: params.project,
      processId: params.process_id,
      sessionId: params.session_id,
      branch: params.branch,
    });

    return this.createSuccessResult({ snapshot });
  }
}
```

`start-session`, `save-context`, `end-session`은 모두 `SessionCheckpointService`를 사용하고, 실제 DB write는 기존 `RememberTool` payload 규약을 따른다.
구체적으로는 continuity 도구가 `RememberTool.handle()`을 내부적으로 호출해 저장까지 완료하고, 자신은 session metadata 또는 snapshot만 가공해 반환한다.

assistant 전용 도구는 `memento-core`의 기본 MCP 도구 레지스트리에 직접 섞지 않는다. 대신 `packages/memento-assistant/src/continuity/tool-registry.ts`에서 별도 assistant tool registry를 만들고, `packages/memento-assistant/src/server/assistant-http-server.ts` 같은 thin runtime이 이 registry를 `/assistant/tools/*`로만 노출한다.

즉, 실행 중인 `memento-core` 서버는 continuity 도구를 직접 알지 못한다. assistant runtime이 별도 프로세스 또는 별도 포트에서 기동되어 `memento-core`의 공개 client/API를 호출한다. 이 방식으로 `core -> assistant` 의존을 피한다.

```ts
new StartSessionTool(),
new SaveContextTool(),
new EndSessionTool(),
new ResumeSessionTool(),
```

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest --run packages/memento-assistant/src/continuity/tools/__tests__/start-session-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/save-context-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts packages/memento-assistant/src/continuity/tool-registry.spec.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
```

Expected: PASS. Assistant tool registry should list the four continuity tools, assistant runtime should expose only `/assistant/tools/*`, and `memento-core` 기본 registry는 오염되지 않아야 한다.

**Step 5: Commit**

```bash
git add packages/memento-assistant/src/continuity/tools packages/memento-assistant/src/continuity/tool-registry.ts packages/memento-assistant/src/continuity/tool-registry.spec.ts packages/memento-assistant/src/server/assistant-http-server.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
git commit -m "feat: add continuity MCP tools"
```

---

## Task 4: assistant package의 client/CLI 세션 래퍼 구현

**Files:**
- Modify: `packages/memento-core/src/index.ts`
- Create: `packages/memento-assistant/src/client/assistant-client.ts`
- Create: `packages/memento-assistant/src/client/assistant-client.spec.ts`
- Create: `packages/memento-assistant/src/client/continuity-cli.ts`
- Create: `packages/memento-assistant/src/client/continuity-cli.spec.ts`
- Create: `packages/memento-assistant/src/client/index.ts`
- Modify: `package.json`

**Step 1: Write the failing tests**

`packages/memento-assistant/src/client/assistant-client.spec.ts`에는 assistant client가 continuity 도구를 감싸는 HTTP `/assistant/tools/:name` 호출을 올바르게 만드는지 테스트를 추가한다.

```ts
it('resumeSession should POST to /assistant/tools/resume_session', async () => {
  const client = new AssistantClient({
    assistantServerUrl: 'http://localhost:8090',
  });
  mockPost('/assistant/tools/resume_session', { result: { snapshot: { resume: [] } } });

  const result = await client.resumeSession({
    project: 'memento',
    process_id: 'cursor',
    session_id: 'sess-1',
  });

  expect(result.snapshot.resume).toEqual([]);
});
```

`packages/memento-assistant/src/client/continuity-cli.spec.ts`에는 CLI가 `resume` 명령을 받아 snapshot을 출력하는지를 고정한다.

```ts
it('resume command should print four continuity sections', async () => {
  const output = await runCli(['resume', '--project', 'memento']);
  expect(output).toContain('Resume');
  expect(output).toContain('Recent Decisions');
  expect(output).toContain('Open Threads');
  expect(output).toContain('Next Actions');
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/assistant-client.spec.ts packages/memento-assistant/src/client/continuity-cli.spec.ts
```

Expected: FAIL with missing methods and missing CLI file.

**Step 3: Write minimal implementation**

`packages/memento-assistant/src/client/assistant-client.ts`에 continuity helper 메서드를 추가한다. 이 client는 `memento-core`의 범용 client를 감싸는 product-specific wrapper로 두고, continuity 호출은 assistant runtime의 `/assistant/tools/*`로 보낸다.

여기서 클라이언트 설정은 core와 assistant를 혼동하지 않게 분리한다.

- `assistantServerUrl`
  - continuity runtime 호출용
- `coreServerUrl`
  - 필요 시 범용 memory platform 호출용

Phase 1 예시에서는 `AssistantClient`가 최소한 `assistantServerUrl`을 받고, continuity 관련 메서드는 이 URL로만 호출하도록 둔다. core 호출이 필요한 경우는 내부적으로 별도 core client를 주입받거나, 후속 단계에서 `coreServerUrl` 설정을 추가한다.

```ts
async startSession(params: StartSessionParams) {
  this.ensureConnected();
  const response = await this.httpClient.post('/assistant/tools/start_session', params);
  return response.data.result;
}

async saveContext(params: SaveContextParams) {
  this.ensureConnected();
  const response = await this.httpClient.post('/assistant/tools/save_context', params);
  return response.data.result;
}

async endSession(params: EndSessionParams) {
  this.ensureConnected();
  const response = await this.httpClient.post('/assistant/tools/end_session', params);
  return response.data.result;
}

async resumeSession(params: ResumeSessionParams) {
  this.ensureConnected();
  const response = await this.httpClient.post('/assistant/tools/resume_session', params);
  return response.data.result;
}
```

`packages/memento-assistant/src/client/continuity-cli.ts`는 `tsx`로 실행 가능한 경량 래퍼로 구현한다.

```ts
switch (command) {
  case 'start':
    await client.startSession(parsed);
    break;
  case 'resume':
    const result = await client.resumeSession(parsed);
    printSnapshot(result.snapshot);
    break;
  case 'save':
    await client.saveContext(parsed);
    break;
  case 'end':
    await client.endSession(parsed);
    break;
}
```

`package.json`에는 최소한 아래 항목을 추가한다.

```json
{
  "bin": {
    "memento-continuity": "<assistant build output 경로>"
  },
  "scripts": {
    "dev:continuity-cli": "tsx packages/memento-assistant/src/client/continuity-cli.ts"
  }
}
```

여기서 bin 경로는 하드코딩하기 전에 실제 workspace 빌드 출력 경로를 먼저 확인한다. Step 4에서 반드시 아래를 검증한다.

- build 후 `continuity-cli.js`가 어느 경로에 생성되는지 확인
- `package.json`의 `bin`이 그 경로를 정확히 가리키는지 확인
- 필요하면 `packages/memento-assistant` 전용 build script를 추가

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest --run packages/memento-assistant/src/client/assistant-client.spec.ts packages/memento-assistant/src/client/continuity-cli.spec.ts
npm run type-check
```

Expected: PASS and CLI builds cleanly under TypeScript.

**Step 5: Commit**

```bash
git add packages/memento-core/src/index.ts packages/memento-assistant/src/client/assistant-client.ts packages/memento-assistant/src/client/assistant-client.spec.ts packages/memento-assistant/src/client/continuity-cli.ts packages/memento-assistant/src/client/continuity-cli.spec.ts packages/memento-assistant/src/client/index.ts package.json
git commit -m "feat: add continuity client and CLI wrapper"
```

---

## Task 5: assistant E2E 검증과 사용자 문서 작성

**Files:**
- Create: `packages/memento-assistant/src/test/test-developer-continuity-flow.ts`
- Create: `docs/guides/ko/developer-continuity-assistant-phase1.md`
- Modify: `README.md`
- Modify: `README.en.md`

**Step 1: Write the failing E2E test**

`packages/memento-assistant/src/test/test-developer-continuity-flow.ts`에는 최소 시나리오를 한 번에 검증한다.

```ts
// 1. start_session
// 2. save_context(decision)
// 3. save_context(next-step)
// 4. end_session
// 5. resume_session
// 6. snapshot에 decision과 next-step이 노출되는지 assert
```

예시:

```ts
assert(snapshot.recentDecisions.length > 0, 'recent decisions should not be empty');
assert(snapshot.nextActions.length > 0, 'next actions should not be empty');
```

이 E2E는 기존 `src/test/test-client.ts`와 같은 성격의 스크립트로 두고, 로컬에서 `memento-core` HTTP 서버와 `memento-assistant` thin runtime이 이미 기동된 상태를 전제로 실행한다. CI에 넣을 때도 core 서버 부팅 후 assistant runtime 부팅 단계를 분리한다.

**Step 2: Run test to verify it fails**

Run:

```bash
tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

Expected: FAIL until continuity tools and CLI plumbing are complete.

**Step 3: Write docs**

`docs/guides/ko/developer-continuity-assistant-phase1.md`에 아래를 문서화한다.

- 무엇을 구현했는지
- 어떤 continuity tags를 쓰는지
- CLI 예시:

```bash
memento-continuity start --project memento --process cursor --branch feature/resume
memento-continuity save --kind decision --content "resume 엔진은 recall 기반으로 간다"
memento-continuity end --summary "resume 초안 완료"
memento-continuity resume --project memento
```

- `resume snapshot`의 4개 섹션 의미
- 저장 억제 조건과 승인 경계

README에는 이 문서 링크와 Phase 1 범위만 짧게 추가한다.

**Step 4: Run full verification**

Run:

```bash
npm run type-check
npm run lint
npm test
tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

Expected:

- `type-check`: PASS
- `lint`: PASS
- `npm test`: PASS
- `test-developer-continuity-flow.ts`: PASS with non-empty resume snapshot sections

**Step 5: Commit**

```bash
git add packages/memento-assistant/src/test/test-developer-continuity-flow.ts docs/guides/ko/developer-continuity-assistant-phase1.md README.md README.en.md
git commit -m "docs: add continuity assistant phase1 guide and e2e coverage"
```

---

## 범위 메모

- 이번 계획은 `Phase 1 MVP`만 다룬다.
- 별도 IDE 확장 UI, Slack/Telegram 연동, Action Broker의 승인형 쓰기 실행, Planner 강화는 후속 계획으로 분리한다.
- `resume_session` 응답 계약은 IDE 패널이 소비할 수 있게 만들지만, 패널 구현 자체는 후속 작업으로 둔다.
- 가장 중요한 제약은 `assistant` 기능이 `core`의 내부 구현 세부사항에 직접 의존하지 않는 것이다.

---

## 실행 순서 요약

0. core/assistant package 경계 수립
1. core 공개 계약 + continuity metadata 계약 추가
2. assistant resume/checkpoint 서비스 추가
3. assistant continuity tools 추가
4. assistant client + CLI 래퍼 추가
5. assistant E2E 및 문서로 Phase 1 고정

---

## 실행 옵션

Plan complete and saved to `docs/plans/ko/2026-02-28-memento-developer-continuity-assistant-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
