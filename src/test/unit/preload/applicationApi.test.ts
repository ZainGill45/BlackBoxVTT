import { describe, expect, it, vi } from 'vitest';
import { applicationIpcChannels } from '../../../shared/application';
import { createApplicationApi } from '../../../preload/applicationApi';

describe('createApplicationApi', () => {
  it('exposes only lifecycle senders and validated external-link invocation', async () => {
    const send = vi.fn();
    const invoke = vi.fn(async () => true);
    const api = createApplicationApi(send, invoke);

    api.quit();
    await expect(api.openExternal('https://example.com')).resolves.toBe(true);

    expect(Object.keys(api)).toEqual(['openExternal', 'quit', 'ready']);
    expect(send).toHaveBeenCalledWith(applicationIpcChannels.quit);
    expect(invoke).toHaveBeenCalledWith(
      applicationIpcChannels.openExternal,
      { url: 'https://example.com' },
    );
  });

  it('sends the ready signal on its own channel', () => {
    const send = vi.fn();
    const api = createApplicationApi(send);

    api.ready();

    expect(send).toHaveBeenCalledWith(applicationIpcChannels.ready);
  });
});
