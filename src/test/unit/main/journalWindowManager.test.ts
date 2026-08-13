import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JournalWindowManager } from '../../../main/journalWindowManager';
import type { JournalManager } from '../../../main/journalManager';
import type { NetworkManager } from '../../../main/network/networkManager';
import { journalWindowIpcChannels } from '../../../shared/journalWindows';

let nextContentsId = 1;

class FakeWebContents extends EventEmitter {
  readonly id = nextContentsId++;
  readonly send = vi.fn();

  isDestroyed() {
    return false;
  }
}

class FakeWindow extends EventEmitter {
  alwaysOnTopArgs: [boolean, string] | null = null;
  bounds = { height: 931, width: 716, x: 0, y: 0 };
  contentSize: [number, number] = [700, 900];
  destroyed = false;
  focused = false;
  minimized = false;
  restored = false;
  title = '';
  visible = false;
  readonly webContents = new FakeWebContents();

  close() {
    let prevented = false;
    this.emit('close', {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!prevented) {
      this.destroyed = true;
      this.emit('closed');
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }

  focus() {
    this.focused = true;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  isVisible() {
    return this.visible;
  }

  getBounds() {
    return { ...this.bounds };
  }

  getContentSize(): [number, number] {
    return [...this.contentSize];
  }

  restore() {
    this.minimized = false;
    this.restored = true;
  }

  setTitle(title: string) {
    this.title = title;
  }

  setContentSize(width: number, height: number) {
    this.contentSize = [width, height];
    this.bounds.width = width + 16;
    this.bounds.height = height + 31;
  }

  setAlwaysOnTop(flag: boolean, level: string) {
    this.alwaysOnTopArgs = [flag, level];
  }

  setPosition(x: number, y: number) {
    this.bounds.x = x;
    this.bounds.y = y;
  }

  show() {
    this.visible = true;
  }
}

const campaignId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const system = { id: 'dnd5e', settings: { rulesVersion: '5.5e' } };
const character = {
  capabilities: {
    delete: true,
    edit: true,
    managePages: false,
    managePermissions: true,
    reorder: true,
    view: true,
  },
  data: {},
  groupId: 'dnd5e.characters',
  id: entryId,
  detail: null,
  kind: 'system' as const,
  name: 'Aria',
  permissionRevision: 0,
  permissions: { allPlayers: 'none' as const, overrides: [] },
  position: 0,
  revision: 0,
  typeId: 'dnd5e.character',
};

describe('JournalWindowManager', () => {
  let created: FakeWindow[];
  let options: Array<Record<string, unknown>>;
  let manager: JournalWindowManager;

  beforeEach(() => {
    created = [];
    options = [];
    manager = new JournalWindowManager({
      createWindow: (input) => {
        options.push(input as Record<string, unknown>);
        const window = new FakeWindow();
        created.push(window);
        return window as never;
      },
      getMainWindow: () => null,
      getWorkArea: () => ({ height: 1080, width: 1920, x: 0, y: 0 }),
      journalManager: {
        getEntry: vi.fn(async () => ({ ok: true, value: character })),
      } as unknown as JournalManager,
      loadWindow: vi.fn(),
      networkManager: {
        getActiveCampaignSystem: vi.fn(() => system),
      } as unknown as NetworkManager,
      preloadPath: 'detachedCharacterPreload.js',
    });
  });

  it('creates one fixed window per Character and focuses the existing copy', async () => {
    const input = {
      campaignId,
      entryId,
      geometry: {
        contentHeight: 900,
        contentWidth: 700,
        rootFontSize: 16,
      },
    };

    await expect(manager.openCharacter(input)).resolves.toEqual({
      ok: true,
      value: 'opened',
    });
    manager.markReady(created[0].webContents as never);
    created[0].minimized = true;
    await expect(manager.openCharacter(input)).resolves.toEqual({
      ok: true,
      value: 'focused',
    });

    expect(created).toHaveLength(1);
    expect(options[0]).toMatchObject({
      alwaysOnTop: true,
      fullscreenable: false,
      height: 900,
      maximizable: false,
      resizable: false,
      show: false,
      title: 'Aria',
      useContentSize: true,
      width: 700,
    });
    expect(created[0].restored).toBe(true);
    expect(created[0].focused).toBe(true);
    expect(created[0].contentSize).toEqual([700, 900]);
    expect(created[0].alwaysOnTopArgs).toEqual([true, 'screen-saver']);
    expect(created[0].bounds).toEqual({
      height: 931,
      width: 716,
      x: 602,
      y: 75,
    });
  });

  it('caps only the height so the native frame stays above the taskbar', async () => {
    await manager.openCharacter({
      campaignId,
      entryId,
      geometry: {
        contentHeight: 1080,
        contentWidth: 1920,
        rootFontSize: 16,
      },
    });

    expect(created[0].contentSize).toEqual([1920, 1049]);
    expect(created[0].bounds).toEqual({
      height: 1080,
      width: 1936,
      x: -8,
      y: 0,
    });
    expect(created[0].alwaysOnTopArgs).toEqual([true, 'screen-saver']);
    await expect(manager.bootstrap(created[0].webContents as never)).resolves
      .toMatchObject({
        ok: true,
        value: {
          geometry: {
            contentHeight: 1049,
            contentWidth: 1920,
            rootFontSize: 16,
          },
        },
      });
  });

  it('bootstraps from authoritative state and waits for the renderer close handshake', async () => {
    await manager.openCharacter({
      campaignId,
      entryId,
      geometry: {
        contentHeight: 900,
        contentWidth: 700,
        rootFontSize: 16,
      },
    });
    const window = created[0];
    manager.markReady(window.webContents as never);

    await expect(manager.bootstrap(window.webContents as never)).resolves.toMatchObject({
      ok: true,
      value: {
        campaignId,
        entry: { id: entryId, name: 'Aria' },
        system,
      },
    });
    manager.setTitle(window.webContents as never, 'Renamed Aria');
    expect(window.title).toBe('Renamed Aria');

    const closing = manager.closeCampaign(campaignId);
    expect(window.webContents.send).toHaveBeenCalledWith(
      journalWindowIpcChannels.closeRequested,
    );
    expect(window.destroyed).toBe(false);
    manager.confirmClose(window.webContents as never);
    await closing;

    expect(window.destroyed).toBe(true);
    expect(manager.getWebContents()).toEqual([]);
  });
});
