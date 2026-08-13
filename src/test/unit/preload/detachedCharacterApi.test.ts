import { describe, expect, it, vi } from 'vitest';
import { createDetachedCharacterApi } from '../../../preload/detachedCharacterApi';
import { journalIpcChannels } from '../../../shared/journal';
import { journalWindowIpcChannels } from '../../../shared/journalWindows';
import { networkIpcChannels } from '../../../shared/network';

describe('createDetachedCharacterApi', () => {
  it('exposes only the Character sheet capabilities', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const ipc = {
      invoke: vi.fn(async () => ({ ok: true, value: null })),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn(),
      send: vi.fn(),
    };
    const api = createDetachedCharacterApi(ipc as never);

    await api.host.bootstrap();
    await api.journal.getEntry({ campaignId: 'campaign', entryId: 'entry' });
    await api.journal.list({ campaignId: 'campaign' });
    await api.journal.renameEntry({
      campaignId: 'campaign',
      entryId: 'entry',
      expectedRevision: 0,
      name: 'Aria',
    });
    await api.journal.updateEntryData({
      campaignId: 'campaign',
      data: {},
      entryId: 'entry',
      expectedRevision: 0,
    });
    await api.network.sendChatMessage({
      campaignId: 'campaign',
      clientMessageId: 'stat-message',
      content: 'Armor Class: 15',
      recipient: null,
    });
    await api.network.sendChatRoll({
      campaignId: 'campaign',
      clientMessageId: 'message',
      definition: {
        category: 'Roll',
        sections: [],
        title: 'Check',
      },
      recipient: null,
    });
    api.host.ready();
    api.host.setTitle('Aria');
    api.host.close();

    expect(Object.keys(api)).toEqual(['host', 'journal', 'network']);
    expect(Object.keys(api.journal)).toEqual([
      'getEntry',
      'list',
      'onChanged',
      'renameEntry',
      'updateEntryData',
    ]);
    expect(
      (ipc.invoke.mock.calls as unknown[][]).map(([channel]) => channel),
    ).toEqual([
      journalWindowIpcChannels.bootstrapCharacter,
      journalIpcChannels.getEntry,
      journalIpcChannels.list,
      journalIpcChannels.renameEntry,
      journalIpcChannels.updateEntryData,
      networkIpcChannels.sendChatMessage,
      networkIpcChannels.sendChatRoll,
    ]);
    expect(
      (ipc.send.mock.calls as unknown[][]).map(([channel]) => channel),
    ).toEqual([
      journalWindowIpcChannels.ready,
      journalWindowIpcChannels.setTitle,
      journalWindowIpcChannels.closeCharacter,
    ]);
  });

  it('subscribes and removes the two allowed event listeners', () => {
    const ipc = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    };
    const api = createDetachedCharacterApi(ipc as never);
    const removeClose = api.host.onCloseRequested(vi.fn());
    const removeChanged = api.journal.onChanged(vi.fn());

    removeClose();
    removeChanged();

    expect(ipc.on.mock.calls.map(([channel]) => channel)).toEqual([
      journalWindowIpcChannels.closeRequested,
      journalIpcChannels.changed,
    ]);
    expect(ipc.removeListener).toHaveBeenCalledTimes(2);
  });
});
