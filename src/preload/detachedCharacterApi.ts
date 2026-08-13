import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { journalIpcChannels } from '../shared/journal';
import {
  journalWindowIpcChannels,
  type DetachedCharacterApi,
} from '../shared/journalWindows';
import { networkIpcChannels } from '../shared/network';

export function createDetachedCharacterApi(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener' | 'send'>,
): DetachedCharacterApi {
  return {
    host: {
      bootstrap: () =>
        ipc.invoke(journalWindowIpcChannels.bootstrapCharacter) as ReturnType<
          DetachedCharacterApi['host']['bootstrap']
        >,
      close: () => ipc.send(journalWindowIpcChannels.closeCharacter),
      onCloseRequested: (listener) => {
        const handler = () => listener();
        ipc.on(journalWindowIpcChannels.closeRequested, handler);
        return () =>
          ipc.removeListener(journalWindowIpcChannels.closeRequested, handler);
      },
      ready: () => ipc.send(journalWindowIpcChannels.ready),
      setTitle: (title) =>
        ipc.send(journalWindowIpcChannels.setTitle, { title }),
    },
    journal: {
      getEntry: (input) => ipc.invoke(journalIpcChannels.getEntry, input),
      list: (input) => ipc.invoke(journalIpcChannels.list, input),
      onChanged: (listener) => {
        const handler = (_event: IpcRendererEvent, value: unknown) =>
          listener(value as Parameters<typeof listener>[0]);
        ipc.on(journalIpcChannels.changed, handler);
        return () => ipc.removeListener(journalIpcChannels.changed, handler);
      },
      renameEntry: (input) =>
        ipc.invoke(journalIpcChannels.renameEntry, input),
      updateEntryData: (input) =>
        ipc.invoke(journalIpcChannels.updateEntryData, input),
    },
    network: {
      sendChatMessage: (input) =>
        ipc.invoke(networkIpcChannels.sendChatMessage, input),
      sendChatRoll: (input) =>
        ipc.invoke(networkIpcChannels.sendChatRoll, input),
    },
  };
}
