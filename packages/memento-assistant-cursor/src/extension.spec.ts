import { describe, expect, it, vi } from 'vitest';

import {
  activateHostAdapter,
  createHostPanelShell,
  DEFAULT_END_COMMAND_ID,
  DEFAULT_REFRESH_COMMAND_ID,
  DEFAULT_RESUME_PANEL_VIEW_ID,
  DEFAULT_SAVE_COMMAND_ID,
  DEFAULT_START_COMMAND_ID,
  type HostDisposable,
} from './extension.js';

describe('activateHostAdapter', () => {
  it('registers the resume panel view provider and refresh command', async () => {
    const registerWebviewViewProvider = vi.fn().mockReturnValue({ dispose() {} } satisfies HostDisposable);
    const commandHandlers = new Map<string, () => Promise<void> | void>();
    const registerCommand = vi.fn().mockImplementation((commandId, handler) => {
      commandHandlers.set(commandId, handler);
      return { dispose() {} } satisfies HostDisposable;
    });
    const provider = {
      refresh: vi.fn().mockResolvedValue('<html />'),
      handleAction: vi.fn().mockResolvedValue('<html />'),
    };
    const subscriptions: HostDisposable[] = [];

    const activation = activateHostAdapter(
      {
        subscriptions,
        window: { registerWebviewViewProvider },
        commands: { registerCommand },
      },
      { provider },
    );

    expect(registerWebviewViewProvider).toHaveBeenCalledWith(
      DEFAULT_RESUME_PANEL_VIEW_ID,
      activation.shell,
    );
    expect(registerCommand).toHaveBeenCalledWith(
      DEFAULT_REFRESH_COMMAND_ID,
      expect.any(Function),
    );
    expect(subscriptions).toHaveLength(2);
    expect(activation.provider).toBe(provider);
    expect(activation.shell).toBeDefined();

    await commandHandlers.get(DEFAULT_REFRESH_COMMAND_ID)?.();
    expect(provider.refresh).toHaveBeenCalledTimes(1);
  });

  it('registers start/save/end commands when quick actions are provided', async () => {
    const registerWebviewViewProvider = vi.fn().mockReturnValue({ dispose() {} } satisfies HostDisposable);
    const commandHandlers = new Map<string, () => Promise<void> | void>();
    const registerCommand = vi.fn().mockImplementation((commandId, handler) => {
      commandHandlers.set(commandId, handler);
      return { dispose() {} } satisfies HostDisposable;
    });
    const provider = {
      refresh: vi.fn().mockResolvedValue('<html />'),
      handleAction: vi.fn().mockResolvedValue('<html />'),
    };
    const subscriptions: HostDisposable[] = [];

    activateHostAdapter(
      {
        subscriptions,
        window: { registerWebviewViewProvider },
        commands: { registerCommand },
      },
      {
        provider,
        quickActions: {
          start: { createAction: async () => ({ type: 'start', payload: { session_id: 'sess-1' } }) },
          save: {
            createAction: async () => ({
              type: 'save',
              payload: { kind: 'decision', content: 'Use adapter-first' },
            }),
          },
          end: { createAction: async () => ({ type: 'end', payload: { summary: 'Wrap up' } }) },
        },
      },
    );

    await commandHandlers.get(DEFAULT_START_COMMAND_ID)?.();
    await commandHandlers.get(DEFAULT_SAVE_COMMAND_ID)?.();
    await commandHandlers.get(DEFAULT_END_COMMAND_ID)?.();

    expect(provider.handleAction).toHaveBeenNthCalledWith(1, {
      type: 'start',
      payload: { session_id: 'sess-1' },
    });
    expect(provider.handleAction).toHaveBeenNthCalledWith(2, {
      type: 'save',
      payload: { kind: 'decision', content: 'Use adapter-first' },
    });
    expect(provider.handleAction).toHaveBeenNthCalledWith(3, {
      type: 'end',
      payload: { summary: 'Wrap up' },
    });
    expect(subscriptions).toHaveLength(5);
  });

  it('creates a reusable host panel shell that can be registered separately', () => {
    const provider = {
      refresh: vi.fn().mockResolvedValue('<html />'),
      handleAction: vi.fn().mockResolvedValue('<html />'),
    };

    const shell = createHostPanelShell(provider);

    expect(shell).toHaveProperty('resolveWebviewView');
    expect(shell).toHaveProperty('refresh');
    expect(shell).toHaveProperty('handleAction');
  });
});
