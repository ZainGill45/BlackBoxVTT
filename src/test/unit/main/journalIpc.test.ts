import type { IpcMain, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerJournalIpcHandlers } from '../../../main/journalIpc';
import type { JournalManager } from '../../../main/journalManager';
import { journalIpcChannels } from '../../../shared/journal';

const campaignId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';

function setup() {
  const handlers = new Map<string, (event: { sender: WebContents }, input?: unknown) => unknown>();
  const sender = { id: 1, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
  const manager = {
    deleteTarget: vi.fn(async () => ({ ok: true, value: { cleanupFailures: [] } })),
    list: vi.fn(async () => ({ ok: true, value: { entries: [], revision: 0, schemaVersion: 2 } })),
    off: vi.fn(),
    on: vi.fn(),
  } as unknown as JournalManager;
  const ipc = {
    handle: vi.fn((channel: string, handler: (event: { sender: WebContents }, input?: unknown) => unknown) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  } as unknown as IpcMain;
  const unregister = registerJournalIpcHandlers(ipc, manager, (candidate) => candidate === sender, () => [sender]);
  const invoke = (channel: string, input?: unknown, eventSender = sender) => handlers.get(channel)?.({ sender: eventSender }, input);
  return { handlers, invoke, manager, sender, unregister };
}

describe('registerJournalIpcHandlers', () => {
  it('validates requests and derives renderer authority from the sender', async () => {
    const { invoke, manager } = setup();

    await invoke(journalIpcChannels.list, { campaignId });
    expect(manager.list).toHaveBeenCalledWith(campaignId);

    expect(await invoke(journalIpcChannels.list, { campaignId, role: 'gm' })).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(await invoke(journalIpcChannels.list, { campaignId }, {} as WebContents)).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(manager.list).toHaveBeenCalledOnce();
  });

  it('keeps note and page deletion on their matching explicit channels', async () => {
    const { invoke, manager } = setup();
    const common = { campaignId, cleanupAssetIds: [], expectedRevision: 0 };

    expect(await invoke(journalIpcChannels.deletePage, {
      ...common,
      target: { entryId, kind: 'note' },
    })).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    await invoke(journalIpcChannels.deletePage, {
      ...common,
      target: { entryId, kind: 'page', pageId },
    });

    expect(manager.deleteTarget).toHaveBeenCalledOnce();
    expect(manager.deleteTarget).toHaveBeenCalledWith({
      ...common,
      target: { entryId, kind: 'page', pageId },
    });
  });

  it('removes every invoke handler during teardown', () => {
    const { handlers, unregister } = setup();
    expect(handlers.get(journalIpcChannels.updatePage)).toBeDefined();
    unregister();
    expect(handlers.size).toBe(0);
  });
});
