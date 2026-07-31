import {
  applicationIpcChannels,
  type ApplicationApi,
} from '../shared/application';

type IpcSend = (channel: string) => void;

export function createApplicationApi(send: IpcSend): ApplicationApi {
  return {
    quit: () => {
      send(applicationIpcChannels.quit);
    },
    ready: () => {
      send(applicationIpcChannels.ready);
    },
  };
}
