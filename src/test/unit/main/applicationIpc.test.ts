import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { applicationIpcChannels } from '../../../shared/application';
import {
  registerApplicationIpcHandlers,
  type ApplicationIpcRegistrar,
} from '../../../main/applicationIpc';

type OpenExternalHandler = (
  _event: unknown,
  input: unknown,
) => Promise<boolean>;

let listeners: Map<string, () => void>;
let handlers: Map<string, OpenExternalHandler>;
let quit: Mock<() => void>;
let ready: Mock<() => void>;
let openExternal: Mock<(url: string) => Promise<void>>;
let retryRenderer: Mock<() => void>;
let unregister: () => void;

beforeEach(() => {
  listeners = new Map();
  handlers = new Map();
  const ipc: ApplicationIpcRegistrar = {
    handle: vi.fn((channel, listener) => {
      handlers.set(channel, listener);
    }),
    on: vi.fn((channel, listener) => {
      listeners.set(channel, listener);
    }),
    removeHandler: vi.fn((channel) => {
      handlers.delete(channel);
    }),
    removeListener: vi.fn((channel, listener) => {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
    }),
  };
  quit = vi.fn<() => void>();
  ready = vi.fn<() => void>();
  openExternal = vi.fn(async () => undefined);
  retryRenderer = vi.fn<() => void>();
  unregister = registerApplicationIpcHandlers(
    ipc,
    quit,
    ready,
    openExternal,
    retryRenderer,
  );
});

function handleOpenExternal(): OpenExternalHandler {
  const handler = handlers.get(applicationIpcChannels.openExternal);
  if (!handler) {
    throw new Error('The external-link handler was never registered.');
  }
  return handler;
}

describe('application lifecycle channels', () => {
  it('listens on exactly the lifecycle channels', () => {
    expect([...listeners.keys()]).toEqual([
      applicationIpcChannels.quit,
      applicationIpcChannels.ready,
      applicationIpcChannels.retryRenderer,
    ]);
  });

  it('quits the application when the renderer asks', () => {
    listeners.get(applicationIpcChannels.quit)?.();

    expect(quit).toHaveBeenCalledOnce();
  });

  it('reports the renderer ready when it signals', () => {
    listeners.get(applicationIpcChannels.ready)?.();

    expect(ready).toHaveBeenCalledOnce();
  });

  it('retries the renderer from the stable recovery screen', () => {
    listeners.get(applicationIpcChannels.retryRenderer)?.();

    expect(retryRenderer).toHaveBeenCalledOnce();
  });

  it('removes every listener and handler on unregister', () => {
    unregister();

    expect(listeners).toHaveLength(0);
    expect(handlers).toHaveLength(0);
  });
});

describe('external link validation', () => {
  it('opens an http URL through the shell', async () => {
    await expect(
      handleOpenExternal()(null, { url: 'https://example.com/path' }),
    ).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path');
  });

  it('opens a mailto URL through the shell', async () => {
    await expect(
      handleOpenExternal()(null, { url: 'mailto:gm@example.com' }),
    ).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith('mailto:gm@example.com');
  });

  it('refuses a javascript: URL', async () => {
    await expect(
      handleOpenExternal()(null, { url: 'javascript:alert(1)' }),
    ).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses input that is not a URL at all', async () => {
    await expect(
      handleOpenExternal()(null, { url: 'not a URL' }),
    ).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
