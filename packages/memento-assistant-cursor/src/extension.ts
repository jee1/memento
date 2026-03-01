import type { ResumePanelAction } from './panel/resume-panel-provider.js';

export const DEFAULT_RESUME_PANEL_VIEW_ID = 'mementoAssistant.resumePanel';
export const DEFAULT_REFRESH_COMMAND_ID = 'mementoAssistant.refresh';
export const DEFAULT_START_COMMAND_ID = 'mementoAssistant.start';
export const DEFAULT_SAVE_COMMAND_ID = 'mementoAssistant.save';
export const DEFAULT_END_COMMAND_ID = 'mementoAssistant.end';

export interface HostDisposable {
  dispose(): void;
}

export interface HostWindowBindings {
  registerWebviewViewProvider(
    viewId: string,
    provider: HostWebviewViewProvider,
  ): HostDisposable;
}

export interface HostCommandBindings {
  registerCommand(
    commandId: string,
    handler: () => Promise<void> | void,
  ): HostDisposable;
}

export interface HostExtensionBindings {
  subscriptions: HostDisposable[];
  window: HostWindowBindings;
  commands: HostCommandBindings;
}

export interface HostWebviewBindings {
  setHtml(html: string): void;
  onDidReceiveMessage(
    handler: (message: unknown) => Promise<void> | void,
  ): HostDisposable;
}

export interface HostWebviewView {
  webview: HostWebviewBindings;
}

export interface HostWebviewViewProvider {
  resolveWebviewView(view: HostWebviewView): Promise<void> | void;
}

export interface RefreshablePanelProvider {
  refresh(): Promise<string> | string;
}

export interface ActionablePanelProvider extends RefreshablePanelProvider {
  handleAction(action: ResumePanelAction): Promise<string> | string;
}

export interface HostQuickActionBinding {
  commandId?: string;
  createAction: () => Promise<ResumePanelAction> | ResumePanelAction;
}

export interface HostAdapterActivationOptions {
  provider: ActionablePanelProvider;
  viewId?: string;
  refreshCommandId?: string;
  quickActions?: {
    start?: HostQuickActionBinding;
    save?: HostQuickActionBinding;
    end?: HostQuickActionBinding;
  };
}

export interface HostAdapterActivationResult {
  provider: ActionablePanelProvider;
  shell: HostPanelShell;
}

export interface HostPanelShell extends HostWebviewViewProvider {
  refresh(): Promise<string>;
  handleAction(action: ResumePanelAction): Promise<string>;
}

function isResumePanelAction(message: unknown): message is ResumePanelAction {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return type === 'refresh' || type === 'start' || type === 'save' || type === 'end';
}

export function createHostPanelShell(
  provider: ActionablePanelProvider,
): HostPanelShell {
  let activeView: HostWebviewView | undefined;

  const updateHtml = (html: string): string => {
    activeView?.webview.setHtml(html);
    return html;
  };

  return {
    async resolveWebviewView(view) {
      activeView = view;
      view.webview.onDidReceiveMessage(async (message) => {
        if (!isResumePanelAction(message)) {
          return;
        }

        updateHtml(await provider.handleAction(message));
      });

      updateHtml(await provider.refresh());
    },
    async refresh() {
      return updateHtml(await provider.refresh());
    },
    async handleAction(action) {
      return updateHtml(await provider.handleAction(action));
    },
  };
}

function registerQuickAction(
  bindings: HostExtensionBindings,
  provider: ActionablePanelProvider,
  quickAction: HostQuickActionBinding | undefined,
  fallbackCommandId: string,
): HostDisposable | undefined {
  if (!quickAction) {
    return undefined;
  }

  return bindings.commands.registerCommand(
    quickAction.commandId ?? fallbackCommandId,
    async () => {
      await provider.handleAction(await quickAction.createAction());
    },
  );
}

export function activateHostAdapter(
  bindings: HostExtensionBindings,
  options: HostAdapterActivationOptions,
): HostAdapterActivationResult {
  const viewId = options.viewId ?? DEFAULT_RESUME_PANEL_VIEW_ID;
  const refreshCommandId = options.refreshCommandId ?? DEFAULT_REFRESH_COMMAND_ID;
  const shell = createHostPanelShell(options.provider);

  const providerDisposable = bindings.window.registerWebviewViewProvider(
    viewId,
    shell,
  );
  const refreshDisposable = bindings.commands.registerCommand(
    refreshCommandId,
    async () => {
      await shell.refresh();
    },
  );
  const startDisposable = registerQuickAction(
    bindings,
    shell,
    options.quickActions?.start,
    DEFAULT_START_COMMAND_ID,
  );
  const saveDisposable = registerQuickAction(
    bindings,
    shell,
    options.quickActions?.save,
    DEFAULT_SAVE_COMMAND_ID,
  );
  const endDisposable = registerQuickAction(
    bindings,
    shell,
    options.quickActions?.end,
    DEFAULT_END_COMMAND_ID,
  );

  bindings.subscriptions.push(providerDisposable, refreshDisposable);

  for (const disposable of [startDisposable, saveDisposable, endDisposable]) {
    if (disposable) {
      bindings.subscriptions.push(disposable);
    }
  }

  return {
    provider: options.provider,
    shell,
  };
}
