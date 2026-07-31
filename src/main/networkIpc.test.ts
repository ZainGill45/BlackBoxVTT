import { describe, expect, it, vi } from 'vitest';
import { networkIpcChannels } from '../shared/network';
import type { NetworkManager } from './network/networkManager';
import {
  registerNetworkIpcHandlers,
} from './networkIpc';

type Handler = (
  event: { sender: unknown },
  input?: unknown,
) => unknown;

describe('registerNetworkIpcHandlers', () => {
  it('rejects malformed payloads and calls only for the allowed renderer', async () => {
    const handlers = new Map<string, Handler>();
    const ipc = {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    };
    const connect = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'connection_failed' as const,
        message: 'not running',
      },
    }));
    const manager = {
      connect,
      off: vi.fn(),
      on: vi.fn(),
    } as unknown as NetworkManager;
    const allowedSender = {};
    registerNetworkIpcHandlers(
      ipc as never,
      manager,
      () => allowedSender as never,
    );
    const invokeConnect = handlers.get(networkIpcChannels.connect);
    expect(invokeConnect).toBeDefined();

    expect(
      await invokeConnect?.(
        { sender: allowedSender },
        { host: '', port: 70_000 },
      ),
    ).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(
      await invokeConnect?.(
        { sender: {} },
        { host: '127.0.0.1', port: 30_000 },
      ),
    ).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(connect).not.toHaveBeenCalled();

    await invokeConnect?.(
      { sender: allowedSender },
      { host: '127.0.0.1', port: 30_000 },
    );
    expect(connect).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 30_000,
    });
  });

  it('validates outgoing pings and forwards accepted ping events', async () => {
    const handlers = new Map<string, Handler>();
    const listeners = new Map<string, (value: unknown) => void>();
    const ipc = {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    };
    const sendMapPing = vi.fn(async () => undefined);
    const sendMeasurementUpdate = vi.fn(async () => undefined);
    const manager = {
      off: vi.fn(),
      on: vi.fn((name: string, listener: (value: unknown) => void) => {
        listeners.set(name, listener);
      }),
      sendMapPing,
      sendMeasurementUpdate,
    } as unknown as NetworkManager;
    const webContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    };
    registerNetworkIpcHandlers(
      ipc as never,
      manager,
      () => webContents as never,
    );
    const invoke = handlers.get(networkIpcChannels.sendMapPing);
    const ping = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      id: '22222222-2222-4222-8222-222222222222',
      pullPlayers: true,
      sceneId: '33333333-3333-4333-8333-333333333333',
      x: 100,
      y: 200,
    };

    await invoke?.({ sender: webContents }, ping);
    expect(sendMapPing).toHaveBeenCalledWith(ping);
    await invoke?.({ sender: webContents }, { ...ping, x: Infinity });
    expect(sendMapPing).toHaveBeenCalledTimes(1);

    const measurement = {
      active: true,
      campaignId: '11111111-1111-4111-8111-111111111111',
      measurementId: '44444444-4444-4444-8444-444444444444',
      points: [{ x: 10, y: 20 }],
      sceneId: '33333333-3333-4333-8333-333333333333',
      updateSequence: 1,
    };
    await handlers
      .get(networkIpcChannels.sendMeasurementUpdate)
      ?.({ sender: webContents }, measurement);
    expect(sendMeasurementUpdate).toHaveBeenCalledWith(measurement);
    await handlers
      .get(networkIpcChannels.sendMeasurementUpdate)
      ?.(
        { sender: webContents },
        { ...measurement, active: false },
      );
    expect(sendMeasurementUpdate).toHaveBeenCalledTimes(1);

    listeners.get('map-ping')?.(ping);
    expect(webContents.send).toHaveBeenCalledWith(
      networkIpcChannels.mapPing,
      ping,
    );
    listeners.get('measurement-update')?.(measurement);
    expect(webContents.send).toHaveBeenCalledWith(
      networkIpcChannels.measurementUpdate,
      measurement,
    );
  });
});
