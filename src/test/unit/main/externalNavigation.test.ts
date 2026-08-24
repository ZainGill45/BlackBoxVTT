import { describe, expect, it, vi } from 'vitest';
import {
  denyInAppNavigation,
  denyInAppWindowOpen,
} from '../../../main/externalNavigation';

function invokeGuard(url: string) {
  const openExternal = vi.fn(async () => undefined);
  const setWindowOpenHandler = vi.fn();
  denyInAppWindowOpen({ setWindowOpenHandler }, openExternal);
  const handler = setWindowOpenHandler.mock.calls[0]?.[0];
  expect(handler).toBeTypeOf('function');
  return {
    openExternal,
    response: handler({
      disposition: 'new-window',
      features: '',
      frameName: '',
      referrer: { policy: 'strict-origin-when-cross-origin' as const, url: '' },
      url,
    }),
  };
}

describe('in-app window.open guard', () => {
  it('denies the popup and opens allowed URLs through the shell', () => {
    const { openExternal, response } = invokeGuard('https://example.com/handout');
    expect(response).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/handout');
  });

  it('denies javascript: popups without calling the shell', () => {
    const { openExternal, response } = invokeGuard('javascript:alert(1)');
    expect(response).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

function invokeNavigationGuard(url: string, appUrl = 'app://renderer/index.html') {
  const openExternal = vi.fn(async () => undefined);
  const on = vi.fn();
  denyInAppNavigation({ on }, openExternal, (candidate) => candidate === appUrl);
  const handler = on.mock.calls.find(([event]) => event === 'will-navigate')?.[1];
  expect(handler).toBeTypeOf('function');
  const preventDefault = vi.fn();
  handler({ preventDefault }, url);
  return { openExternal, preventDefault };
}

describe('in-app navigation guard', () => {
  it('keeps the window put and sends the link to the shell', () => {
    const { openExternal, preventDefault } = invokeNavigationGuard(
      'https://example.com/handout',
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/handout');
  });

  it('blocks a javascript: navigation without calling the shell', () => {
    const { openExternal, preventDefault } = invokeNavigationGuard('javascript:alert(1)');
    expect(preventDefault).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('allows the renderer to reload its own URL', () => {
    const { openExternal, preventDefault } = invokeNavigationGuard(
      'app://renderer/index.html',
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
