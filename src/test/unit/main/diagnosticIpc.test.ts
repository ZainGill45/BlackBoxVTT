import type { IpcMain, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticService } from '../../../main/diagnostics/diagnosticService';
import { registerDiagnosticIpcHandlers } from '../../../main/diagnostics/diagnosticIpc';
import { diagnosticIpcChannels } from '../../../shared/diagnostics';

function setup() {
  const handlers = new Map<string, (event: never, input?: unknown) => unknown>();
  const listeners = new Map<string, (event: never, input?: unknown) => void>();
  const ipc = {
    handle: vi.fn((channel: string, listener: never) => handlers.set(channel, listener)),
    on: vi.fn((channel: string, listener: never) => listeners.set(channel, listener)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
  } as unknown as IpcMain;
  const webContents = {
    id: 17,
    isDestroyed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;
  const service = new DiagnosticService({
    development: true,
    instance: {
      appVersion: '1.0.0',
      electronVersion: '43.2.0',
      environment: 'development',
      label: 'default',
      platform: 'win32',
      processId: 42,
      profileKind: 'persistent',
    },
  });
  const unregister = registerDiagnosticIpcHandlers(
    ipc,
    service,
    () => webContents,
  );
  return { handlers, listeners, service, unregister, webContents };
}

describe('registerDiagnosticIpcHandlers', () => {
  it('accepts only validated messages from the main window', async () => {
    const { handlers, listeners, service, webContents } = setup();

    listeners.get(diagnosticIpcChannels.record)?.(
      { sender: webContents } as never,
      { category: 'ui', level: 'warn', message: 'A warning' },
    );
    listeners.get(diagnosticIpcChannels.record)?.(
      { sender: webContents } as never,
      { category: '', level: 'fatal', message: 'invalid' },
    );
    listeners.get(diagnosticIpcChannels.record)?.(
      { sender: { id: 99 } } as never,
      { category: 'ui', level: 'error', message: 'foreign' },
    );

    const snapshot = await handlers.get(diagnosticIpcChannels.snapshot)?.(
      { sender: webContents } as never,
    );
    expect(snapshot).toMatchObject({
      events: [{ category: 'ui', message: 'A warning', source: 'renderer' }],
    });
    expect(service.snapshot().events).toHaveLength(1);
    expect(() => handlers.get(diagnosticIpcChannels.snapshot)?.(
      { sender: { id: 99 } } as never,
    )).toThrow('denied');
  });

  it('relays bounded service events and unregisters all surfaces', () => {
    const { handlers, listeners, service, unregister, webContents } = setup();

    service.record('main', {
      category: 'application',
      level: 'info',
      message: 'ready',
    });

    expect(webContents.send).toHaveBeenCalledWith(
      diagnosticIpcChannels.changed,
      expect.objectContaining({ message: 'ready' }),
    );
    unregister();
    expect(handlers.size).toBe(0);
    expect(listeners.size).toBe(0);
  });
});
