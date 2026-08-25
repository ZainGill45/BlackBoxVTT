import {
  applicationIpcChannels,
  parseExternalUrl,
} from '../shared/application';

export interface ApplicationIpcRegistrar {
  handle(
    channel: string,
    listener: (_event: unknown, input: unknown) => Promise<boolean>,
  ): void;
  on(channel: string, listener: () => void): void;
  removeHandler(channel: string): void;
  removeListener(channel: string, listener: () => void): void;
}

export function registerApplicationIpcHandlers(
  ipc: ApplicationIpcRegistrar,
  quit: () => void,
  ready: () => void,
  openExternal: (url: string) => Promise<void>,
  retryRenderer: () => void = () => undefined,
) {
  const handleQuit = () => {
    quit();
  };
  const handleReady = () => {
    ready();
  };
  const handleRetryRenderer = () => {
    retryRenderer();
  };
  ipc.removeHandler(applicationIpcChannels.openExternal);
  ipc.handle(
    applicationIpcChannels.openExternal,
    async (_event, input) => {
      if (!input || typeof input !== 'object' || !('url' in input)) {
        return false;
      }
      const url = parseExternalUrl(input.url);
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
  ipc.on(applicationIpcChannels.retryRenderer, handleRetryRenderer);

  return () => {
    ipc.removeHandler(applicationIpcChannels.openExternal);
    ipc.removeListener(applicationIpcChannels.quit, handleQuit);
    ipc.removeListener(applicationIpcChannels.ready, handleReady);
    ipc.removeListener(
      applicationIpcChannels.retryRenderer,
      handleRetryRenderer,
    );
  };
}
