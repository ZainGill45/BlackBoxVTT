import { describe, expect, it, vi } from 'vitest';
import { assetIpcChannels } from '../shared/assets';
import { createAssetApi } from './assetApi';

describe('createAssetApi', () => {
  it('maps asset requests and removes event listeners', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: [] }));
    const on = vi.fn();
    const removeListener = vi.fn();
    const api = createAssetApi({ invoke, on, removeListener });

    await api.list({ campaignId: 'campaign' });
    expect(invoke).toHaveBeenCalledWith(assetIpcChannels.list, {
      campaignId: 'campaign',
    });

    const listener = vi.fn();
    const remove = api.onChanged(listener);
    expect(on).toHaveBeenCalledWith(
      assetIpcChannels.changed,
      expect.any(Function),
    );
    remove();
    expect(removeListener).toHaveBeenCalledWith(
      assetIpcChannels.changed,
      expect.any(Function),
    );
  });
});
