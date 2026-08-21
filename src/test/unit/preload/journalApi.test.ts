import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJournalApi } from '../../../preload/journalApi';
import { journalIpcChannels } from '../../../shared/journal';

let invoke: ReturnType<typeof vi.fn>;
let on: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof createJournalApi>;

beforeEach(() => {
  invoke = vi.fn(async () => ({ ok: true, value: null }));
  on = vi.fn();
  removeListener = vi.fn();
  api = createJournalApi({ invoke, on, removeListener });
});

describe('createJournalApi', () => {
  it('sends system entry data through its explicit channel', async () => {
    const input = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      data: { identity: { className: 'Fighter' } },
      entryId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 4,
    };

    await api.updateEntryData(input);
    expect(invoke).toHaveBeenCalledWith(journalIpcChannels.updateEntryData, input);
  });

  it('uses separate note and page delete channels', async () => {
    const campaignId = '11111111-1111-4111-8111-111111111111';
    const entryId = '22222222-2222-4222-8222-222222222222';
    await api.deleteTarget({ campaignId, cleanupAssetIds: [], expectedRevision: 0, target: { entryId, kind: 'note' } });
    await api.deleteTarget({ campaignId, cleanupAssetIds: [], expectedRevision: 0, target: { entryId, kind: 'page', pageId: '33333333-3333-4333-8333-333333333333' } });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      journalIpcChannels.deleteNote,
      journalIpcChannels.deletePage,
    ]);
  });

  it('subscribes and removes Journal invalidation listeners', () => {
    const remove = api.onChanged(vi.fn());
    expect(on).toHaveBeenCalledWith(journalIpcChannels.changed, expect.any(Function));
    remove();
    expect(removeListener).toHaveBeenCalledWith(journalIpcChannels.changed, expect.any(Function));
  });

  it('subscribes and removes Journal preparation progress listeners', () => {
    const remove = api.onPreparationProgress(vi.fn());
    expect(on).toHaveBeenCalledWith(
      journalIpcChannels.preparationProgress,
      expect.any(Function),
    );
    remove();
    expect(removeListener).toHaveBeenCalledWith(
      journalIpcChannels.preparationProgress,
      expect.any(Function),
    );
  });
});
