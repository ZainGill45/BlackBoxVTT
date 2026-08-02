import { beforeEach, describe, expect, it, vi } from 'vitest';
import { networkIpcChannels } from '../../../shared/network';
import type { NetworkManager } from '../../../main/network/networkManager';
import { registerNetworkIpcHandlers } from '../../../main/networkIpc';

type Handler = (event: { sender: unknown }, input?: unknown) => unknown;

const campaignId = '11111111-1111-4111-8111-111111111111';
const sceneId = '33333333-3333-4333-8333-333333333333';

const ping = {
  campaignId,
  id: '22222222-2222-4222-8222-222222222222',
  pullPlayers: true,
  sceneId,
  x: 100,
  y: 200,
};

const measurement = {
  active: true,
  campaignId,
  measurementId: '44444444-4444-4444-8444-444444444444',
  points: [{ x: 10, y: 20 }],
  sceneId,
  updateSequence: 1,
};

describe('network IPC sender authorization', () => {
  let handlers: Map<string, Handler>;
  let connect: ReturnType<typeof vi.fn>;
  let allowedSender: object;

  beforeEach(() => {
    handlers = new Map();
    connect = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'connection_failed' as const, message: 'not running' },
    }));
    allowedSender = {};
    registerNetworkIpcHandlers(
      {
        handle: vi.fn((channel: string, handler: Handler) => {
          handlers.set(channel, handler);
        }),
        removeHandler: vi.fn(),
      } as never,
      { connect, off: vi.fn(), on: vi.fn() } as unknown as NetworkManager,
      () => allowedSender as never,
    );
  });

  it('registers a handler for the connect channel', () => {
    expect(handlers.get(networkIpcChannels.connect)).toBeDefined();
  });

  it('rejects a malformed payload from the allowed renderer', async () => {
    const invokeConnect = handlers.get(networkIpcChannels.connect);

    expect(
      await invokeConnect?.({ sender: allowedSender }, { host: '', port: 70_000 }),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects a valid payload from a renderer it does not own', async () => {
    const invokeConnect = handlers.get(networkIpcChannels.connect);

    expect(
      await invokeConnect?.({ sender: {} }, { host: '127.0.0.1', port: 30_000 }),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    expect(connect).not.toHaveBeenCalled();
  });

  it('forwards a valid payload from the allowed renderer', async () => {
    const invokeConnect = handlers.get(networkIpcChannels.connect);

    await invokeConnect?.(
      { sender: allowedSender },
      { host: '127.0.0.1', port: 30_000 },
    );

    expect(connect).toHaveBeenCalledWith({ host: '127.0.0.1', port: 30_000 });
  });
});

describe('network IPC live traffic', () => {
  let handlers: Map<string, Handler>;
  let listeners: Map<string, (value: unknown) => void>;
  let sendMapPing: ReturnType<typeof vi.fn>;
  let sendMeasurementUpdate: ReturnType<typeof vi.fn>;
  let webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    handlers = new Map();
    listeners = new Map();
    sendMapPing = vi.fn(async () => undefined);
    sendMeasurementUpdate = vi.fn(async () => undefined);
    webContents = { isDestroyed: () => false, send: vi.fn() };
    registerNetworkIpcHandlers(
      {
        handle: vi.fn((channel: string, handler: Handler) => {
          handlers.set(channel, handler);
        }),
        removeHandler: vi.fn(),
      } as never,
      {
        off: vi.fn(),
        on: vi.fn((name: string, listener: (value: unknown) => void) => {
          listeners.set(name, listener);
        }),
        sendMapPing,
        sendMeasurementUpdate,
      } as unknown as NetworkManager,
      () => webContents as never,
    );
  });

  it('forwards a well-formed outgoing ping', async () => {
    await handlers.get(networkIpcChannels.sendMapPing)?.(
      { sender: webContents },
      ping,
    );

    expect(sendMapPing).toHaveBeenCalledWith(ping);
  });

  it('drops an outgoing ping with a non-finite coordinate', async () => {
    await handlers.get(networkIpcChannels.sendMapPing)?.(
      { sender: webContents },
      { ...ping, x: Infinity },
    );

    expect(sendMapPing).not.toHaveBeenCalled();
  });

  it('forwards a well-formed outgoing measurement', async () => {
    await handlers.get(networkIpcChannels.sendMeasurementUpdate)?.(
      { sender: webContents },
      measurement,
    );

    expect(sendMeasurementUpdate).toHaveBeenCalledWith(measurement);
  });

  it('drops an inactive measurement that still carries points', async () => {
    await handlers.get(networkIpcChannels.sendMeasurementUpdate)?.(
      { sender: webContents },
      { ...measurement, active: false },
    );

    expect(sendMeasurementUpdate).not.toHaveBeenCalled();
  });

  it('relays an incoming ping to the renderer', () => {
    listeners.get('map-ping')?.(ping);

    expect(webContents.send).toHaveBeenCalledWith(
      networkIpcChannels.mapPing,
      ping,
    );
  });

  it('relays an incoming measurement to the renderer', () => {
    listeners.get('measurement-update')?.(measurement);

    expect(webContents.send).toHaveBeenCalledWith(
      networkIpcChannels.measurementUpdate,
      measurement,
    );
  });

});
