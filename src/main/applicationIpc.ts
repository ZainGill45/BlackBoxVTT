import { applicationIpcChannels } from '../shared/application';

export interface ApplicationIpcRegistrar {
  on(channel: string, listener: () => void): void;
  removeListener(channel: string, listener: () => void): void;
}

export function registerApplicationIpcHandlers(
  ipc: ApplicationIpcRegistrar,
  quit: () => void,
  ready: () => void,
) {
  const handleQuit = () => {
    quit();
  };
  const handleReady = () => {
    ready();
  };

  ipc.on(applicationIpcChannels.quit, handleQuit);
  ipc.on(applicationIpcChannels.ready, handleReady);

  return () => {
    ipc.removeListener(applicationIpcChannels.quit, handleQuit);
    ipc.removeListener(applicationIpcChannels.ready, handleReady);
  };
}
