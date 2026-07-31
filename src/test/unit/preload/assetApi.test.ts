import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetIpcChannels } from '../../../shared/assets';
import { createAssetApi } from '../../../preload/assetApi';

let invoke: ReturnType<typeof vi.fn>;
let on: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof createAssetApi>;

beforeEach(() => {
  invoke = vi.fn(async () => ({ ok: true, value: [] }));
  on = vi.fn();
  removeListener = vi.fn();
  api = createAssetApi({ invoke, on, removeListener });
});

describe('createAssetApi', () => {
  it('sends a list request on the asset list channel', async () => {
    await api.list({ campaignId: 'campaign' });

    expect(invoke).toHaveBeenCalledWith(assetIpcChannels.list, {
      campaignId: 'campaign',
    });
  });

  it('subscribes to asset change events', () => {
    api.onChanged(vi.fn());

    expect(on).toHaveBeenCalledWith(
      assetIpcChannels.changed,
      expect.any(Function),
    );
  });

  it('removes the change listener when unsubscribed', () => {
    const remove = api.onChanged(vi.fn());

    remove();

    expect(removeListener).toHaveBeenCalledWith(
      assetIpcChannels.changed,
      expect.any(Function),
    );
  });
});
