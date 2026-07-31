import {
  applicationIpcChannels,
  type ApplicationApi,
} from '../shared/application';

type IpcSend = (channel: string) => void;
type IpcInvoke = (channel: string, input: unknown) => Promise<unknown>;

export function createApplicationApi(
  send: IpcSend,
  invoke: IpcInvoke = async () => false,
): ApplicationApi {
  return {
    openExternal: (url) =>
      invoke(applicationIpcChannels.openExternal, { url }) as Promise<boolean>,
    quit: () => {
      send(applicationIpcChannels.quit);
    },
    ready: () => {
      send(applicationIpcChannels.ready);
    },
  };
}
