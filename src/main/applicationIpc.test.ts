import { describe, expect, it, vi } from 'vitest';
import { applicationIpcChannels } from '../shared/application';
import {
  registerApplicationIpcHandlers,
  type ApplicationIpcRegistrar,
} from './applicationIpc';

describe('registerApplicationIpcHandlers', () => {
  it('registers and removes only the application quit and ready listeners', () => {
    const listeners = new Map<string, () => void>();
    const ipc: ApplicationIpcRegistrar = {
      on: vi.fn((channel, listener) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn((channel, listener) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel);
        }
      }),
    };
    const quit = vi.fn();
    const ready = vi.fn();

    const unregister = registerApplicationIpcHandlers(ipc, quit, ready);

    expect([...listeners.keys()]).toEqual([
      applicationIpcChannels.quit,
      applicationIpcChannels.ready,
    ]);
    listeners.get(applicationIpcChannels.quit)?.();
    expect(quit).toHaveBeenCalledOnce();
    listeners.get(applicationIpcChannels.ready)?.();
    expect(ready).toHaveBeenCalledOnce();

    unregister();
    expect(listeners).toHaveLength(0);
  });
});
