import { describe, expect, it, vi } from 'vitest';
import { applicationIpcChannels } from '../shared/application';
import { createApplicationApi } from './applicationApi';

describe('createApplicationApi', () => {
  it('exposes only the narrow quit and ready senders', () => {
    const send = vi.fn();
    const api = createApplicationApi(send);

    api.quit();

    expect(Object.keys(api)).toEqual(['quit', 'ready']);
    expect(send).toHaveBeenCalledWith(applicationIpcChannels.quit);
  });

  it('sends the ready signal on its own channel', () => {
    const send = vi.fn();
    const api = createApplicationApi(send);

    api.ready();

    expect(send).toHaveBeenCalledWith(applicationIpcChannels.ready);
  });
});
