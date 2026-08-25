import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticsApi } from '../../../preload/diagnosticsApi';
import { diagnosticIpcChannels } from '../../../shared/diagnostics';

function setup() {
  const listeners = new Map<string, (...args: never[]) => void>();
  const ipc = {
    invoke: vi.fn(async () => undefined),
    on: vi.fn((channel: string, listener: (...args: never[]) => void) => {
      listeners.set(channel, listener);
    }),
    removeListener: vi.fn(),
    send: vi.fn(),
  } as unknown as IpcRenderer;
  return { api: createDiagnosticsApi(ipc), ipc, listeners };
}

describe('createDiagnosticsApi', () => {
  it('exposes only the explicit diagnostic request surface', async () => {
    const { api, ipc } = setup();

    api.record({ category: 'ui', level: 'info', message: 'ready' });
    api.updateContext({ screen: 'play' });
    await api.inspect({ provider: 'instance' });
    await api.snapshot();
    await api.clear();

    expect(ipc.send).toHaveBeenCalledWith(
      diagnosticIpcChannels.record,
      { category: 'ui', level: 'info', message: 'ready' },
    );
    expect(ipc.send).toHaveBeenCalledWith(
      diagnosticIpcChannels.updateContext,
      { screen: 'play' },
    );
    expect(ipc.invoke).toHaveBeenCalledWith(
      diagnosticIpcChannels.inspect,
      { provider: 'instance' },
    );
  });

  it('delivers a crash-open request that arrived before React subscribed', async () => {
    const { api, listeners } = setup();
    const listener = vi.fn();

    listeners.get(diagnosticIpcChannels.openRequested)?.(
      {} as IpcRendererEvent as never,
    );
    api.onOpenRequested(listener);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledOnce();
  });
});
