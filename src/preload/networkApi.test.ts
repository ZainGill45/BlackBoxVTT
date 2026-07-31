import { describe, expect, it, vi } from 'vitest';
import { networkIpcChannels } from '../shared/network';
import { createNetworkApi, type NetworkIpcRenderer } from './networkApi';

describe('createNetworkApi', () => {
  it('exposes only the narrow network methods and removes subscriptions', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipc: NetworkIpcRenderer = {
      invoke: vi.fn(async () => ({ ok: true, value: null })),
      on: vi.fn((channel, listener) => {
        listeners.set(channel, listener as (...args: unknown[]) => void);
      }),
      removeListener: vi.fn(),
    };
    const api = createNetworkApi(ipc);

    expect(Object.keys(api).sort()).toEqual([
      'acceptTrust',
      'authenticate',
      'cancelConnection',
      'connect',
      'createUser',
      'deleteHistory',
      'deleteUser',
      'disconnect',
      'getHostStatus',
      'getServerSettings',
      'listHistory',
      'onClientStateChanged',
      'onDrawingPreview',
      'onHostStatusChanged',
      'onMapPing',
      'onMeasurementUpdate',
      'onSessionClosed',
      'onTransformCancelled',
      'onTransformPreview',
      'onTransformStarted',
      'openHost',
      'resetPassword',
      'sendDrawingPreview',
      'sendMapPing',
      'sendMeasurementUpdate',
      'setPort',
      'setTransformPreviewRate',
      'stopHost',
      'updateUsername',
    ]);

    await api.connect({ host: 'vtt.local', port: 30_000 });
    expect(ipc.invoke).toHaveBeenCalledWith(networkIpcChannels.connect, {
      host: 'vtt.local',
      port: 30_000,
    });

    await api.sendMapPing({
      campaignId: '11111111-1111-4111-8111-111111111111',
      id: '22222222-2222-4222-8222-222222222222',
      pullPlayers: true,
      sceneId: '33333333-3333-4333-8333-333333333333',
      x: 100,
      y: 200,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(
      networkIpcChannels.sendMapPing,
      {
        campaignId: '11111111-1111-4111-8111-111111111111',
        id: '22222222-2222-4222-8222-222222222222',
        pullPlayers: true,
        sceneId: '33333333-3333-4333-8333-333333333333',
        x: 100,
        y: 200,
      },
    );

    await api.sendMeasurementUpdate({
      active: true,
      campaignId: '11111111-1111-4111-8111-111111111111',
      measurementId: '22222222-2222-4222-8222-222222222222',
      points: [{ x: 100, y: 200 }],
      sceneId: '33333333-3333-4333-8333-333333333333',
      updateSequence: 1,
    });
    expect(ipc.invoke).toHaveBeenCalledWith(
      networkIpcChannels.sendMeasurementUpdate,
      expect.objectContaining({ active: true, updateSequence: 1 }),
    );

    const listener = vi.fn();
    const unsubscribe = api.onHostStatusChanged(listener);
    listeners.get(networkIpcChannels.hostStatusChanged)?.(
      {} as never,
      { state: 'online' },
    );
    expect(listener).toHaveBeenCalledWith({ state: 'online' });
    unsubscribe();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      networkIpcChannels.hostStatusChanged,
      expect.any(Function),
    );

    const pingListener = vi.fn();
    const unsubscribePing = api.onMapPing(pingListener);
    listeners.get(networkIpcChannels.mapPing)?.(
      {} as never,
      { id: 'ping' },
    );
    expect(pingListener).toHaveBeenCalledWith({ id: 'ping' });
    unsubscribePing();

    const measurementListener = vi.fn();
    const unsubscribeMeasurement =
      api.onMeasurementUpdate(measurementListener);
    listeners.get(networkIpcChannels.measurementUpdate)?.(
      {} as never,
      { measurementId: 'measurement' },
    );
    expect(measurementListener).toHaveBeenCalledWith({
      measurementId: 'measurement',
    });
    unsubscribeMeasurement();
  });
});
