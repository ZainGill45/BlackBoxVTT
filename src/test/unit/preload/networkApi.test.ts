import { beforeEach, describe, expect, it, vi } from 'vitest';
import { networkIpcChannels } from '../../../shared/network';
import {
  createNetworkApi,
  type NetworkIpcRenderer,
} from '../../../preload/networkApi';

const campaignId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const sceneId = '33333333-3333-4333-8333-333333333333';

let listeners: Map<string, (...args: unknown[]) => void>;
let ipc: NetworkIpcRenderer;
let api: ReturnType<typeof createNetworkApi>;

beforeEach(() => {
  listeners = new Map();
  ipc = {
    invoke: vi.fn(async () => ({ ok: true, value: null })),
    on: vi.fn((channel, listener) => {
      listeners.set(channel, listener as (...args: unknown[]) => void);
    }),
    removeListener: vi.fn(),
  };
  api = createNetworkApi(ipc);
});

describe('createNetworkApi surface', () => {
  it('exposes exactly the intended methods and nothing more', () => {
    // This is the contextIsolation boundary: anything added here becomes
    // reachable from renderer code, so the list is deliberately exhaustive.
    expect(Object.keys(api).sort()).toEqual([
      'acceptTrust',
      'authenticate',
      'cancelConnection',
      'clearChatHistory',
      'connect',
      'createUser',
      'deleteHistory',
      'deleteUser',
      'disconnect',
      'getChatBootstrap',
      'getChatHistory',
      'getHostStatus',
      'getServerSettings',
      'listHistory',
      'onChatEvent',
      'onClientStateChanged',
      'onDrawingPreview',
      'onHostStatusChanged',
      'onMapPing',
      'onMeasurementUpdate',
      'onSessionClosed',
      'onShapePreview',
      'onTransformCancelled',
      'onTransformPreview',
      'onTransformStarted',
      'openHost',
      'resetPassword',
      'sendChatMessage',
      'sendDrawingPreview',
      'sendMapPing',
      'sendMeasurementUpdate',
      'sendShapePreview',
      'setMaxChatMessageCharacters',
      'setPort',
      'setTransformPreviewRate',
      'stopHost',
      'updateUsername',
    ]);
  });
});

describe('createNetworkApi requests', () => {
  it('sends a connection request on its own channel', async () => {
    await api.connect({ host: 'vtt.local', port: 30_000 });

    expect(ipc.invoke).toHaveBeenCalledWith(networkIpcChannels.connect, {
      host: 'vtt.local',
      port: 30_000,
    });
  });

  it('forwards a map ping unchanged', async () => {
    const ping = {
      campaignId,
      id: secondId,
      pullPlayers: true,
      sceneId,
      x: 100,
      y: 200,
    };

    await api.sendMapPing(ping);

    expect(ipc.invoke).toHaveBeenCalledWith(networkIpcChannels.sendMapPing, ping);
  });

  it('forwards a measurement update unchanged', async () => {
    await api.sendMeasurementUpdate({
      active: true,
      campaignId,
      measurementId: secondId,
      points: [{ x: 100, y: 200 }],
      sceneId,
      updateSequence: 1,
    });

    expect(ipc.invoke).toHaveBeenCalledWith(
      networkIpcChannels.sendMeasurementUpdate,
      expect.objectContaining({ active: true, updateSequence: 1 }),
    );
  });
});

describe('createNetworkApi subscriptions', () => {
  it('delivers host status events to the subscriber', () => {
    const listener = vi.fn();
    api.onHostStatusChanged(listener);

    listeners.get(networkIpcChannels.hostStatusChanged)?.({} as never, {
      state: 'online',
    });

    // The renderer must never see the raw IpcRendererEvent.
    expect(listener).toHaveBeenCalledWith({ state: 'online' });
  });

  it('removes the host status listener when unsubscribed', () => {
    const unsubscribe = api.onHostStatusChanged(vi.fn());

    unsubscribe();

    expect(ipc.removeListener).toHaveBeenCalledWith(
      networkIpcChannels.hostStatusChanged,
      expect.any(Function),
    );
  });

  it('delivers map pings to the subscriber', () => {
    const listener = vi.fn();
    api.onMapPing(listener);

    listeners.get(networkIpcChannels.mapPing)?.({} as never, { id: 'ping' });

    expect(listener).toHaveBeenCalledWith({ id: 'ping' });
  });

  it('removes the map ping listener when unsubscribed', () => {
    const unsubscribe = api.onMapPing(vi.fn());

    unsubscribe();

    expect(ipc.removeListener).toHaveBeenCalledWith(
      networkIpcChannels.mapPing,
      expect.any(Function),
    );
  });

  it('delivers measurement updates to the subscriber', () => {
    const listener = vi.fn();
    api.onMeasurementUpdate(listener);

    listeners.get(networkIpcChannels.measurementUpdate)?.({} as never, {
      measurementId: 'measurement',
    });

    expect(listener).toHaveBeenCalledWith({ measurementId: 'measurement' });
  });

  it('removes the measurement listener when unsubscribed', () => {
    const unsubscribe = api.onMeasurementUpdate(vi.fn());

    unsubscribe();

    expect(ipc.removeListener).toHaveBeenCalledWith(
      networkIpcChannels.measurementUpdate,
      expect.any(Function),
    );
  });
});
