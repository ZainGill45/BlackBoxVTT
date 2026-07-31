import { applicationIpcChannels } from '../shared/application';

export interface ApplicationIpcRegistrar {
  handle(
    channel: string,
    listener: (_event: unknown, input: unknown) => Promise<boolean>,
  ): void;
  on(channel: string, listener: () => void): void;
  removeHandler(channel: string): void;
  removeListener(channel: string, listener: () => void): void;
}

export function parseExternalHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 16_384) {
    return null;
  }
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function registerApplicationIpcHandlers(
  ipc: ApplicationIpcRegistrar,
  quit: () => void,
  ready: () => void,
  openExternal: (url: string) => Promise<void>,
) {
  const handleQuit = () => {
    quit();
  };
  const handleReady = () => {
    ready();
  };
  ipc.removeHandler(applicationIpcChannels.openExternal);
  ipc.handle(
    applicationIpcChannels.openExternal,
    async (_event, input) => {
      if (!input || typeof input !== 'object' || !('url' in input)) {
        return false;
      }
      const url = parseExternalHttpUrl(input.url);
      if (!url) {
        return false;
      }
      try {
        await openExternal(url);
        return true;
      } catch {
        return false;
      }
    },
  );

  ipc.on(applicationIpcChannels.quit, handleQuit);
  ipc.on(applicationIpcChannels.ready, handleReady);

  return () => {
    ipc.removeHandler(applicationIpcChannels.openExternal);
    ipc.removeListener(applicationIpcChannels.quit, handleQuit);
    ipc.removeListener(applicationIpcChannels.ready, handleReady);
  };
}
