import { describe, expect, it, vi } from 'vitest';
import { sceneIpcChannels } from '../shared/scenes';
import { createSceneApi } from './sceneApi';

describe('createSceneApi', () => {
  it('maps scene requests onto their channels', async () => {
    const channels: string[] = [];
    const invoke = vi.fn(async (channel: string) => {
      channels.push(channel);
      return { ok: true, value: null };
    });
    const api = createSceneApi({
      invoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    });
    const campaignId = '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325';
    const sceneId = '11111111-1111-4111-8111-111111111111';
    const assetId = '22222222-2222-4222-8222-222222222222';

    await api.list({ campaignId });
    await api.create({ campaignId });
    await api.update({
      campaignId,
      expectedRevision: 3,
      patch: { width: 64 },
      sceneId,
    });
    await api.trash({ campaignId, expectedRevision: 3, sceneId });
    await api.present({ campaignId, sceneId });
    await api.findDependents({ assetId, campaignId });
    await api.detachAsset({ assetId, campaignId });

    expect(channels).toEqual([
      sceneIpcChannels.list,
      sceneIpcChannels.create,
      sceneIpcChannels.update,
      sceneIpcChannels.trash,
      sceneIpcChannels.present,
      sceneIpcChannels.findDependents,
      sceneIpcChannels.detachAsset,
    ]);
    expect(invoke).toHaveBeenCalledWith(sceneIpcChannels.update, {
      campaignId,
      expectedRevision: 3,
      patch: { width: 64 },
      sceneId,
    });
  });

  it('removes change listeners on unsubscribe', () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    const api = createSceneApi({
      invoke: vi.fn(async () => undefined),
      on,
      removeListener,
    });

    const remove = api.onChanged(vi.fn());
    expect(on).toHaveBeenCalledWith(
      sceneIpcChannels.changed,
      expect.any(Function),
    );

    remove();
    expect(removeListener).toHaveBeenCalledWith(
      sceneIpcChannels.changed,
      expect.any(Function),
    );
  });
});
