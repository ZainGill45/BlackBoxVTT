import { beforeEach, describe, expect, it, vi } from 'vitest';
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
let quit: ReturnType<typeof vi.fn>;
let ready: ReturnType<typeof vi.fn>;
let openExternal: ReturnType<typeof vi.fn>;
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
  quit = vi.fn();
  ready = vi.fn();
  openExternal = vi.fn(async () => undefined);
  unregister = registerApplicationIpcHandlers(ipc, quit, ready, openExternal);
});

function handleOpenExternal(): OpenExternalHandler {
  const handler = handlers.get(applicationIpcChannels.openExternal);
  if (!handler) {
    throw new Error('The external-link handler was never registered.');
  }
  return handler;
}

describe('application lifecycle channels', () => {
  it('listens on exactly the quit and ready channels', () => {
    expect([...listeners.keys()]).toEqual([
      applicationIpcChannels.quit,
      applicationIpcChannels.ready,
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
