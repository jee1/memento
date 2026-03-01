# Developer Continuity Assistant Host Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `packages/memento-assistant`를 continuity의 정본으로 유지하면서, 이를 소비하는 첫 번째 reference host adapter를 추가한다. 첫 구현은 read-only panel에서 시작하되, 제품 중심이 panel이 아니라 runtime이라는 점을 코드 구조로 강제한다.

**Architecture:** runtime은 계속 `packages/memento-assistant`에 남긴다. 새 host adapter package는 workspace/branch context를 수집하고, runtime HTTP API를 호출해 snapshot을 렌더링한다. Cursor는 첫 reference host가 될 수 있지만, 구현 순서는 `adapter contract -> shared view model -> reference host shell` 순서로 둔다.

**Tech Stack:** TypeScript, npm workspaces, existing `memento-assistant` HTTP runtime, Vitest, optional Cursor/VS Code-compatible extension host.

---

## 0. 실행 현황

2026-03-01 기준 현재 구현 상태:

- `packages/memento-assistant-cursor` workspace package 추가 완료
- Task 1 완료: `panel-context`, `resume-snapshot-view-model`
- Task 2 완료: `assistant-panel-client`
- Task 3 완료: `resume-panel-provider`, `webview-template`
- Task 4 완료: `activateHostAdapter`, command registration, `createHostPanelShell`
- Task 5 완료: `refresh / start / save / end` quick capture와 webview message bridge
- Task 6 완료: 문서/가이드 정렬

현재 코드 기준으로 보면 이번 계획은 “panel 설계 초안”이 아니라, 이미 돌아가는 reference host shell 위에 남은 문서 정리와 host-specific 마무리를 관리하는 실행 문서다.

---

## 1. 구현 원칙

- `memento-assistant`가 continuity의 정본이다.
- host adapter는 thin shell이어야 한다.
- host adapter는 runtime 비즈니스 로직을 직접 구현하지 않는다.
- panel은 first surface일 뿐 product core가 아니다.
- 첫 reference host는 Cursor일 수 있지만, host-specific 코드는 가장 바깥 계층에만 둔다.
- 이 panel은 AI와 대화하는 chat surface가 아니라, 상태 표시와 최소 제어를 위한 continuity surface다.

---

## 2. 제안 접근 방식

### Option A. Adapter Contract First

- 공통 context 타입
- runtime HTTP client
- snapshot view model
- 이후 reference host 연결

장점:

- host 다양성에 가장 안전하다.
- 문서에서 정리한 오해를 코드 구조로 차단한다.

단점:

- 패널이 바로 보이기까지 한 단계가 더 있다.

**권장안**: 추천.

### Option B. Cursor Package First

- 곧바로 `packages/memento-assistant-cursor`부터 만든다.

장점:

- 데모는 빠를 수 있다.

단점:

- shared contract가 뒤로 밀리면 다시 Cursor 중심 구조가 된다.

---

## 3. 구현 범위

이번 계획의 범위:

- host adapter 공통 contract 정리
- runtime HTTP client 분리
- snapshot view model 정리
- read-only reference panel
- 최소 `Refresh / Start / Save / End`
- 첫 reference host 연결

이번 계획의 비범위:

- 자유 대화형 chat panel
- chat-first UI
- planner/dashboard
- full memory search UI
- Action Broker
- 파일 수정/명령 실행 승인
- 여러 host를 동시에 완성

---

## 4. Task 1: adapter contract와 shared view model 정리

**Files:**
- Create: `packages/memento-assistant-host-shared/package.json` 또는 초기에는 `packages/memento-assistant-cursor/src/shared/*`
- Create: `panel-context.ts`
- Create: `resume-snapshot-view-model.ts`
- Create: `resume-snapshot-view-model.spec.ts`

### Step 1: failing test 작성

다음 규칙을 먼저 고정한다.

- host context는 `project`, `branch`, `session_id`, `process_id`를 가진다.
- snapshot view model은 항상 네 섹션을 만든다.
- view model은 host-specific API를 몰라야 한다.

예시:

```ts
it('maps runtime snapshot into a host-agnostic panel model', () => {
  const vm = toResumeSnapshotViewModel({
    project: 'memento',
    resume: [{ title: 'task: one', summary: 'Task one', memoryIds: ['m1'] }],
    recentDecisions: [],
    openThreads: [],
    nextActions: [],
  });

  expect(vm.sections.map((section) => section.key)).toEqual([
    'resume',
    'recent-decisions',
    'open-threads',
    'next-actions',
  ]);
});
```

### Step 2: 실패 확인

Run:

```bash
npx vitest --run <shared-view-model-spec>
```

Expected: FAIL

### Step 3: 최소 구현

- panel context 타입 추가
- host-agnostic view model 추가
- 섹션 타이틀과 empty/error 상태 매핑 추가

핵심 기준:

- shared 모듈은 Cursor, VS Code 같은 host 타입을 몰라도 된다.
- 오직 runtime 응답을 화면 친화 구조로 바꾸는 데 집중한다.

### Step 4: 검증

Run:

```bash
npx vitest --run <shared-view-model-spec>
npm run type-check
```

Expected: PASS

---

## 5. Task 2: assistant runtime HTTP client 분리

**Files:**
- Create: `assistant-panel-client.ts`
- Create: `assistant-panel-client.spec.ts`

### Step 1: failing test 작성

고정할 계약:

- `resume_session`
- `start_session`
- `save_context`
- `end_session`

예시:

```ts
it('calls resume_session over HTTP without importing runtime internals', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { snapshot: { project: 'memento', resume: [], recentDecisions: [], openThreads: [], nextActions: [] } } }),
  });

  const client = createAssistantPanelClient({
    assistantServerUrl: 'http://localhost:8090',
    fetchImpl: fetchMock,
  });

  await client.resume({ project: 'memento', process_id: 'cursor' });

  expect(fetchMock).toHaveBeenCalled();
});
```

### Step 2: 실패 확인

Run:

```bash
npx vitest --run <assistant-panel-client-spec>
```

Expected: FAIL

### Step 3: 최소 구현

- runtime HTTP POST helper
- tool별 메서드 추가
- 실패 시 host에 보여줄 수 있는 축약 오류 래핑

핵심 기준:

- host adapter는 runtime 내부 소스를 import하지 않는다.
- 통신은 HTTP contract 기준으로만 이뤄진다.

### Step 4: 검증

Run:

```bash
npx vitest --run <assistant-panel-client-spec>
npm run type-check
```

Expected: PASS

---

## 6. Task 3: read-only reference panel 추가

**Files:**
- Create: `resume-panel-provider.ts`
- Create: `resume-panel-provider.spec.ts`
- Create: `webview-template.ts`

### Step 1: failing test 작성

고정할 계약:

- panel open 시 `resume_session` 호출
- view model 변환 후 렌더링
- loading/empty/error 상태 지원

예시:

```ts
it('renders a read-only resume snapshot via the shared view model', async () => {
  const resume = vi.fn().mockResolvedValue({
    snapshot: {
      project: 'memento',
      resume: [],
      recentDecisions: [],
      openThreads: [],
      nextActions: [],
    },
  });

  const provider = new ResumePanelProvider({
    client: { resume } as never,
  });

  await provider.refresh();

  expect(resume).toHaveBeenCalled();
});
```

### Step 2: 실패 확인

Run:

```bash
npx vitest --run <resume-panel-provider-spec>
```

Expected: FAIL

### Step 3: 최소 구현

- panel provider 추가
- static HTML 기반 템플릿 추가
- snapshot을 네 섹션으로 렌더링

핵심 기준:

- 처음부터 복잡한 프론트엔드 프레임워크를 넣지 않는다.
- panel은 read-only snapshot view로 시작한다.
- 입력창 중심의 chat UI로 확장하지 않는다.

### Step 4: 검증

Run:

```bash
npx vitest --run <resume-panel-provider-spec>
npm run type-check
```

Expected: PASS

---

## 7. Task 4: 첫 reference host shell 연결

**Files:**
- Create or Modify: `packages/memento-assistant-cursor/*`
- Create: `extension.ts`
- Create: `extension.spec.ts`

### Step 1: failing test 작성

고정할 계약:

- reference host shell은 panel provider를 등록한다.
- refresh command를 연결한다.
- host activation 실패가 runtime 비즈니스 로직을 깨뜨리지 않는다.

예시:

```ts
it('registers the reference panel shell and refresh command', () => {
  const registerWebviewViewProvider = vi.fn();
  const registerCommand = vi.fn();

  activate({
    subscriptions: [],
    window: { registerWebviewViewProvider },
    commands: { registerCommand },
  } as never);

  expect(registerWebviewViewProvider).toHaveBeenCalled();
  expect(registerCommand).toHaveBeenCalled();
});
```

### Step 2: 실패 확인

Run:

```bash
npx vitest --run <extension-spec>
```

Expected: FAIL

### Step 3: 최소 구현

- reference host shell package 추가
- panel registration
- refresh command
- workspace context resolver 연결

핵심 기준:

- host-specific API는 shell 안에 가둔다.
- shared view model과 runtime client는 그대로 재사용한다.

### Step 4: 검증

Run:

```bash
npx vitest --run <extension-spec>
npm run --workspace packages/memento-assistant-cursor type-check
```

Expected: PASS

---

## 8. Task 5: quick capture 최소 액션 추가

**Files:**
- Modify: `resume-panel-provider.ts`
- Modify: `webview-template.ts`
- Modify: host shell command wiring
- Modify: 가이드 문서

### Step 1: failing test 작성

고정할 계약:

- `Start / Save / End / Refresh`
- 액션 후 자동 `resume_session` refresh
- 저장 로직은 runtime에 위임

예시:

```ts
it('delegates save action to the runtime client and refreshes the panel', async () => {
  const save = vi.fn().mockResolvedValue({ memory_id: 'mem-1' });
  const resume = vi.fn().mockResolvedValue({ snapshot: emptySnapshot });

  const provider = new ResumePanelProvider({
    client: { save, resume } as never,
  });

  await provider.handleAction({
    type: 'save',
    payload: { kind: 'decision', content: 'Use adapter-first design' },
  });

  expect(save).toHaveBeenCalled();
  expect(resume).toHaveBeenCalledTimes(1);
});
```

### Step 2: 실패 확인

Run:

```bash
npx vitest --run <quick-capture-spec>
```

Expected: FAIL

### Step 3: 최소 구현

- `Refresh`
- `Start`
- `Save`
- `End`

입력 UI는 단순 prompt/modal 수준으로 제한한다.

핵심 기준:

- quick capture는 convenience layer일 뿐이다.
- 기억 분류와 branch 정책은 runtime이 계속 담당한다.
- quick capture는 채팅 인터랙션이 아니라 짧은 상태 저장 액션으로 제한한다.

실제 구현 메모:

- `ResumePanelProvider.handleAction()`이 runtime client 위임과 refresh를 담당
- `createHostPanelShell()`이 `onDidReceiveMessage`와 `setHtml()`을 담당
- `webview-template.ts`는 `data-action` 버튼과 `postMessage` bridge script를 제공

### Step 4: 검증

Run:

```bash
npx vitest --run <quick-capture-spec>
npm run --workspace packages/memento-assistant-cursor type-check
```

Expected: PASS

---

## 9. Task 6: 문서와 용어 정리

**Files:**
- Modify: `docs/plans/ko/2026-03-01-developer-continuity-assistant-ide-panel-wireframe-design.md`
- Modify: `docs/plans/ko/2026-03-01-developer-continuity-assistant-cursor-panel-technical-design.md`
- Modify: `docs/guides/ko/developer-continuity-assistant-phase1.md`
- Create or Modify: host adapter guide

### 해야 할 일

- `IDE 패널 중심` 표현 삭제
- `assistant runtime 중심 / host adapter 종속` 구조 명시
- Cursor를 `reference host`로 격하
- 추가 host 가능성 명시
- 현재 구현된 as-built 범위와 아직 남은 host-specific 작업을 분리해 서술

### 완료 조건

- 문서만 읽어도 제품 중심축이 runtime임이 분명하다.
- Cursor가 제품 본체처럼 읽히지 않는다.

---

## 10. 검증 전략

필수 검증:

- shared view model unit test
- runtime client unit test
- panel provider unit test
- reference host shell unit test
- workspace type-check

현재까지 통과한 검증:

- `npx vitest --run packages/memento-assistant-cursor/src/**/*.spec.ts`
- `npm run --workspace packages/memento-assistant-cursor type-check`
- `npm run type-check`

후속 검증:

- 로컬 runtime과 reference host를 함께 띄운 E2E
- cross-branch resume 표시 검증
- runtime unavailable 상태 검증

---

## 11. 구현 순서 요약

1. shared contract
2. runtime client
3. read-only panel
4. first reference host
5. quick capture
6. 문서 정리

---

## 12. 결론

이 계획의 핵심은 “IDE 패널을 만든다”가 아니라, **continuity runtime 위에 host adapter를 얹는 구조를 먼저 만든다**는 데 있다.

첫 번째 adapter가 Cursor가 될 수는 있지만, 구현 순서와 코드 구조는 반드시 runtime-first를 강제해야 한다.

현재 구현은 이 결론을 코드로도 반영하고 있다. `memento-assistant-cursor`는 runtime을 소비하는 reference shell까지만 담당하고, continuity 비즈니스 로직은 계속 `packages/memento-assistant`에 남아 있다.
