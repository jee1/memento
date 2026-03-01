export {
  buildPanelContext,
} from './shared/panel-context.js';
export type {
  BuildPanelContextInput,
  PanelContext,
} from './shared/panel-context.js';
export {
  toResumeSnapshotViewModel,
} from './shared/resume-snapshot-view-model.js';
export type {
  ResumeSectionViewModel,
  ResumeSnapshotViewModel,
} from './shared/resume-snapshot-view-model.js';
export {
  createAssistantPanelClient,
} from './services/assistant-panel-client.js';
export type {
  AssistantPanelClient,
  AssistantPanelClientOptions,
} from './services/assistant-panel-client.js';
export { ResumePanelProvider } from './panel/resume-panel-provider.js';
export type {
  ResumePanelAction,
  ResumePanelProviderOptions,
} from './panel/resume-panel-provider.js';
export {
  renderResumePanelHtml,
} from './panel/webview-template.js';
export type {
  ResumePanelRenderState,
} from './panel/webview-template.js';
export {
  activateHostAdapter,
  createHostPanelShell,
  DEFAULT_END_COMMAND_ID,
  DEFAULT_REFRESH_COMMAND_ID,
  DEFAULT_RESUME_PANEL_VIEW_ID,
  DEFAULT_SAVE_COMMAND_ID,
  DEFAULT_START_COMMAND_ID,
} from './extension.js';
export type {
  ActionablePanelProvider,
  HostAdapterActivationOptions,
  HostAdapterActivationResult,
  HostCommandBindings,
  HostDisposable,
  HostExtensionBindings,
  HostPanelShell,
  HostQuickActionBinding,
  HostWebviewBindings,
  HostWebviewView,
  HostWebviewViewProvider,
  HostWindowBindings,
  RefreshablePanelProvider,
} from './extension.js';
