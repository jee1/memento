import { describe, expect, it, vi } from 'vitest';

import { createHostPanelShell, type HostDisposable } from './extension.js';

describe('createHostPanelShell', () => {
  it('refreshes the provider when the webview resolves and updates html on action messages', async () => {
    const refresh = vi.fn().mockResolvedValue('<html>ready</html>');
    const handleAction = vi.fn().mockResolvedValue('<html>saved</html>');
    const setHtml = vi.fn();
    let messageHandler: ((message: unknown) => Promise<void> | void) | undefined;

    const shell = createHostPanelShell({
      refresh,
      handleAction,
    });

    await shell.resolveWebviewView({
      webview: {
        setHtml,
        onDidReceiveMessage: (handler) => {
          messageHandler = handler;
          return { dispose() {} } satisfies HostDisposable;
        },
      },
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setHtml).toHaveBeenNthCalledWith(1, '<html>ready</html>');

    await messageHandler?.({
      type: 'save',
      payload: { kind: 'decision', content: 'Use shell' },
    });

    expect(handleAction).toHaveBeenCalledWith({
      type: 'save',
      payload: { kind: 'decision', content: 'Use shell' },
    });
    expect(setHtml).toHaveBeenNthCalledWith(2, '<html>saved</html>');
  });

  it('ignores malformed webview messages', async () => {
    const refresh = vi.fn().mockResolvedValue('<html>ready</html>');
    const handleAction = vi.fn().mockResolvedValue('<html>saved</html>');
    let messageHandler: ((message: unknown) => Promise<void> | void) | undefined;

    const shell = createHostPanelShell({
      refresh,
      handleAction,
    });

    await shell.resolveWebviewView({
      webview: {
        setHtml: vi.fn(),
        onDidReceiveMessage: (handler) => {
          messageHandler = handler;
          return { dispose() {} } satisfies HostDisposable;
        },
      },
    });

    await messageHandler?.({ type: 'unknown' });

    expect(handleAction).not.toHaveBeenCalled();
  });
});
