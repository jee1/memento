# Developer Continuity Host Adapter Reference

`packages/memento-assistant-cursor`는 `packages/memento-assistant` continuity runtime을 소비하는 첫 번째 reference host adapter package다. 이 package의 목적은 Cursor를 제품 본체로 만드는 것이 아니라, host shell이 runtime을 어떻게 붙여야 하는지 보여주는 최소 구현을 제공하는 데 있다.

## 핵심 원칙

- continuity의 정본은 `packages/memento-assistant`
- host adapter는 thin shell이어야 함
- host adapter는 기억 저장 규칙이나 branch filtering을 직접 구현하지 않음
- 이 panel은 AI 채팅 surface가 아니라 상태 표시와 최소 제어 surface임

## 현재 제공 API

### Shared contract

- `buildPanelContext(input)`
- `toResumeSnapshotViewModel(snapshot)`

### Runtime client

- `createAssistantPanelClient({ assistantServerUrl, fetchImpl? })`

반환 메서드:

- `resume(params)`
- `start(params)`
- `save(params)`
- `end(params)`

### Panel/provider

- `ResumePanelProvider`
  - `refresh()`
  - `handleAction(action)`
  - `getState()`

지원 액션:

- `{ type: 'refresh' }`
- `{ type: 'start', payload: { session_id } }`
- `{ type: 'save', payload: { kind, content } }`
- `{ type: 'end', payload: { summary? } }`

### Host shell

- `createHostPanelShell(provider)`
- `activateHostAdapter(bindings, options)`

기본 상수:

- `DEFAULT_RESUME_PANEL_VIEW_ID`
- `DEFAULT_REFRESH_COMMAND_ID`
- `DEFAULT_START_COMMAND_ID`
- `DEFAULT_SAVE_COMMAND_ID`
- `DEFAULT_END_COMMAND_ID`

## 최소 연결 흐름

1. host가 workspace/branch/session/process 정보를 수집한다.
2. `buildPanelContext()`로 `PanelContext`를 만든다.
3. `createAssistantPanelClient()`로 runtime HTTP client를 만든다.
4. `ResumePanelProvider`에 client와 context를 주입한다.
5. `activateHostAdapter()`로 host bindings에 panel shell과 command를 등록한다.

## Host binding contract

현재 package는 특정 IDE SDK에 직접 의존하지 않고, 아래 추상 binding만 요구한다.

- `HostWindowBindings.registerWebviewViewProvider(viewId, provider)`
- `HostCommandBindings.registerCommand(commandId, handler)`
- `HostWebviewBindings.setHtml(html)`
- `HostWebviewBindings.onDidReceiveMessage(handler)`

즉, 실제 Cursor/VS Code API를 바로 import하지 않고도 같은 shell 구조를 재사용할 수 있다.

## Webview 액션 흐름

`renderResumePanelHtml()`은 아래 `data-action` 버튼을 렌더링한다.

- `refresh`
- `start`
- `save`
- `end`

템플릿에 포함된 bridge script는 `acquireVsCodeApi()?.postMessage(...)` 패턴으로 액션을 host에 전달한다. host shell은 `onDidReceiveMessage()`에서 이 메시지를 받아 `provider.handleAction()`으로 위임하고, 반환된 HTML을 다시 `setHtml()`로 반영한다.

## 현재 구현 범위

- read-only snapshot panel
- loading / empty / error / ready 상태
- prompt/modal 수준의 quick capture
- command palette 경로와 webview 버튼 경로의 공통 orchestration

## 아직 남은 범위

- 실제 Cursor production manifest/activation 파일
- host별 workspace root / branch 자동 추론
- richer form UI
- stale/offline badge
- runtime unavailable 시 추가 recovery action

## 예시

```ts
import {
  ResumePanelProvider,
  activateHostAdapter,
  buildPanelContext,
  createAssistantPanelClient,
} from 'memento-assistant-cursor';

const context = buildPanelContext({
  workspaceName: 'memento',
  branch: 'feature/host-adapter',
  processId: 'cursor',
});

const client = createAssistantPanelClient({
  assistantServerUrl: 'http://localhost:8090',
});

const provider = new ResumePanelProvider({
  client,
  context,
});

activateHostAdapter(bindings, { provider });
```

이 예시는 runtime-first 구조의 핵심만 보여준다. 실제 production host에서는 `bindings`를 IDE별 API에 맞게 어댑트해야 한다.
