import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerJournalWindowIpcHandlers } from '../../../main/journalWindowIpc';
import type { JournalWindowManager } from '../../../main/journalWindowManager';
import { journalWindowIpcChannels } from '../../../shared/journalWindows';

type Handler = (event: { sender: object }, input?: unknown) => unknown;

describe('detached Journal window IPC', () => {
  let allowedSender: object;
  let handlers: Map<string, Handler>;
  let listeners: Map<string, Handler>;
  let manager: {
    bootstrap: ReturnType<typeof vi.fn>;
    closeCampaign: ReturnType<typeof vi.fn>;
    confirmClose: ReturnType<typeof vi.fn>;
    focusCharacter: ReturnType<typeof vi.fn>;
    markReady: ReturnType<typeof vi.fn>;
    openCharacter: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    allowedSender = {};
    handlers = new Map();
    listeners = new Map();
    manager = {
      bootstrap: vi.fn(async () => ({ ok: false })),
      closeCampaign: vi.fn(async () => undefined),
      confirmClose: vi.fn(),
      focusCharacter: vi.fn(() => ({ ok: true, value: false })),
      markReady: vi.fn(),
      openCharacter: vi.fn(async () => ({ ok: true, value: 'opened' })),
      setTitle: vi.fn(),
    };
    registerJournalWindowIpcHandlers(
      {
        handle: vi.fn((channel: string, handler: Handler) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn((channel: string, listener: Handler) => {
          listeners.set(channel, listener);
        }),
        removeHandler: vi.fn(),
        removeListener: vi.fn(),
      } as never,
      manager as unknown as JournalWindowManager,
      (sender) => sender === allowedSender,
    );
  });

  it('validates the main renderer and fixed geometry before opening', async () => {
    const input = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      entryId: '22222222-2222-4222-8222-222222222222',
      geometry: {
        contentHeight: 900,
        contentWidth: 700,
        rootFontSize: 16,
      },
    };
    const open = handlers.get(journalWindowIpcChannels.openCharacter)!;

    await open({ sender: allowedSender }, input);
    expect(manager.openCharacter).toHaveBeenCalledWith(input);

    expect(await open({ sender: {} }, input)).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(
      await open(
        { sender: allowedSender },
        { ...input, geometry: { ...input.geometry, contentWidth: 0 } },
      ),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    expect(manager.openCharacter).toHaveBeenCalledTimes(1);
  });

  it('binds bootstrap and lifecycle signals to their sender', async () => {
    const detachedSender = {};

    await handlers.get(journalWindowIpcChannels.bootstrapCharacter)?.({
      sender: detachedSender,
    });
    listeners.get(journalWindowIpcChannels.ready)?.({ sender: detachedSender });
    listeners.get(journalWindowIpcChannels.setTitle)?.(
      { sender: detachedSender },
      { title: 'Aria' },
    );
    listeners.get(journalWindowIpcChannels.closeCharacter)?.({
      sender: detachedSender,
    });

    expect(manager.bootstrap).toHaveBeenCalledWith(detachedSender);
    expect(manager.markReady).toHaveBeenCalledWith(detachedSender);
    expect(manager.setTitle).toHaveBeenCalledWith(detachedSender, 'Aria');
    expect(manager.confirmClose).toHaveBeenCalledWith(detachedSender);
  });
});
