import type { IpcMain, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { sceneIpcChannels } from '../../../shared/scenes';
import { registerSceneIpcHandlers } from '../../../main/sceneIpc';
import type { SceneManager } from '../../../main/sceneManager';

const campaignId = '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325';
const sceneId = '11111111-1111-4111-8111-111111111111';

function setup() {
  const handlers = new Map<
    string,
    (event: unknown, input?: unknown) => unknown
  >();
  const ipc = {
    handle: vi.fn((channel: string, listener: never) => {
      handlers.set(channel, listener);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  } as unknown as IpcMain;
  const listeners = new Map<string, (event: unknown) => void>();
  const manager = {
    create: vi.fn(async () => ({ ok: true, value: null })),
    detachAsset: vi.fn(async () => ({ ok: true, value: null })),
    findDependents: vi.fn(async () => ({ ok: true, value: [] })),
    list: vi.fn(async () => ({ ok: true, value: null })),
    off: vi.fn((event: string) => listeners.delete(event)),
    on: vi.fn((event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener);
    }),
    present: vi.fn(async () => ({ ok: true, value: null })),
    setFog: vi.fn(async () => ({ ok: true, value: null })),
    trash: vi.fn(async () => ({ ok: true, value: null })),
    update: vi.fn(async () => ({ ok: true, value: null })),
  } as unknown as SceneManager;
  const webContents = {
    isDestroyed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;

  const unregister = registerSceneIpcHandlers(ipc, manager, () => webContents);
  const invoke = (channel: string, input: unknown) =>
    handlers.get(channel)?.({ sender: webContents }, input);

  return { handlers, invoke, listeners, manager, unregister, webContents };
}

describe('registerSceneIpcHandlers', () => {
  it('forwards validated input to the manager', async () => {
    const { handlers, invoke, manager, unregister } = setup();

    await invoke(sceneIpcChannels.list, { campaignId });
    await invoke(sceneIpcChannels.update, {
      campaignId,
      expectedRevision: 2,
      patch: { grid: { type: 'square' }, width: 100 },
      sceneId,
    });
    await invoke(sceneIpcChannels.present, { campaignId, sceneId: null });
    await invoke(sceneIpcChannels.setFog, {
      campaignId,
      expectedRevision: 2,
      mutation: { color: '#123456', kind: 'set-color' },
      operationId: '22222222-2222-4222-8222-222222222222',
      sceneId,
    });

    expect(manager.list).toHaveBeenCalledWith(campaignId);
    expect(manager.update).toHaveBeenCalledWith({
      campaignId,
      expectedRevision: 2,
      patch: { grid: { type: 'square' }, width: 100 },
      sceneId,
    });
    expect(manager.present).toHaveBeenCalledWith({
      campaignId,
      sceneId: null,
    });
    expect(manager.setFog).toHaveBeenCalledWith({
      campaignId,
      expectedRevision: 2,
      mutation: { color: '#123456', kind: 'set-color' },
      operationId: '22222222-2222-4222-8222-222222222222',
      sceneId,
    });

    unregister();
    expect(handlers.size).toBe(0);
  });

  it('rejects malformed input without reaching the manager', async () => {
    const { invoke, manager } = setup();

    const badCampaign = await invoke(sceneIpcChannels.list, {
      campaignId: 'nope',
    });
    const badPatch = await invoke(sceneIpcChannels.update, {
      campaignId,
      expectedRevision: 0,
      // Out of the documented 4–4096 range.
      patch: { grid: { size: 1 } },
      sceneId,
    });
    const unknownField = await invoke(sceneIpcChannels.update, {
      campaignId,
      expectedRevision: 0,
      patch: { revision: 9 },
      sceneId,
    });
    const badFog = await invoke(sceneIpcChannels.setFog, {
      campaignId,
      expectedRevision: 0,
      mutation: { color: 'black', kind: 'set-color' },
      operationId: '22222222-2222-4222-8222-222222222222',
      sceneId,
    });

    expect(badCampaign).toMatchObject({ error: { code: 'invalid_input' } });
    expect(badPatch).toMatchObject({ error: { code: 'invalid_input' } });
    expect(unknownField).toMatchObject({ error: { code: 'invalid_input' } });
    expect(badFog).toMatchObject({ error: { code: 'invalid_input' } });
    expect(manager.list).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.setFog).not.toHaveBeenCalled();
  });

  it('refuses requests from a web contents it does not own', async () => {
    const { handlers, manager } = setup();

    const result = await handlers.get(sceneIpcChannels.list)?.(
      { sender: {} },
      { campaignId },
    );

    expect(result).toMatchObject({ error: { code: 'invalid_input' } });
    expect(manager.list).not.toHaveBeenCalled();
  });

  it('relays manager changes to the renderer', () => {
    const { listeners, webContents } = setup();
    const event = { campaignId, manifest: { scenes: [] } };

    listeners.get('changed')?.(event);

    expect(webContents.send).toHaveBeenCalledWith(
      sceneIpcChannels.changed,
      event,
    );
  });
});
