import type { IpcRendererEvent } from 'electron';
import {
  networkIpcChannels,
  type NetworkApi,
} from '../shared/network';

export interface NetworkIpcRenderer {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    listener: (event: IpcRendererEvent, value: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, value: unknown) => void,
  ): void;
}

export function createNetworkApi(ipc: NetworkIpcRenderer): NetworkApi {
  const subscribe = <T>(
    channel: string,
    listener: (value: T) => void,
  ) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown) => {
      listener(value as T);
    };
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };

  return {
    acceptTrust: (input) =>
      ipc.invoke(networkIpcChannels.acceptTrust, input) as ReturnType<
        NetworkApi['acceptTrust']
      >,
    authenticate: (input) =>
      ipc.invoke(networkIpcChannels.authenticate, input) as ReturnType<
        NetworkApi['authenticate']
      >,
    cancelConnection: (input) =>
      ipc.invoke(networkIpcChannels.cancelConnection, input) as Promise<void>,
    clearChatHistory: (input) =>
      ipc.invoke(
        networkIpcChannels.clearChatHistory,
        input,
      ) as ReturnType<NetworkApi['clearChatHistory']>,
    connect: (input) =>
      ipc.invoke(networkIpcChannels.connect, input) as ReturnType<
        NetworkApi['connect']
      >,
    createUser: (input) =>
      ipc.invoke(networkIpcChannels.createUser, input) as ReturnType<
        NetworkApi['createUser']
      >,
    deleteHistory: (input) =>
      ipc.invoke(networkIpcChannels.deleteHistory, input) as ReturnType<
        NetworkApi['deleteHistory']
      >,
    deleteUser: (input) =>
      ipc.invoke(networkIpcChannels.deleteUser, input) as ReturnType<
        NetworkApi['deleteUser']
      >,
    disconnect: () =>
      ipc.invoke(networkIpcChannels.disconnect) as Promise<void>,
    getHostStatus: () =>
      ipc.invoke(networkIpcChannels.getHostStatus) as ReturnType<
        NetworkApi['getHostStatus']
      >,
    getChatBootstrap: (input) =>
      ipc.invoke(
        networkIpcChannels.getChatBootstrap,
        input,
      ) as ReturnType<NetworkApi['getChatBootstrap']>,
    getChatHistory: (input) =>
      ipc.invoke(
        networkIpcChannels.getChatHistory,
        input,
      ) as ReturnType<NetworkApi['getChatHistory']>,
    getServerSettings: (input) =>
      ipc.invoke(networkIpcChannels.getServerSettings, input) as ReturnType<
        NetworkApi['getServerSettings']
      >,
    listHistory: () =>
      ipc.invoke(networkIpcChannels.listHistory) as ReturnType<
        NetworkApi['listHistory']
      >,
    onClientStateChanged: (listener) =>
      subscribe(networkIpcChannels.clientStateChanged, listener),
    onChatEvent: (listener) =>
      subscribe(networkIpcChannels.chatEvent, listener),
    onDrawingPreview: (listener) =>
      subscribe(networkIpcChannels.drawingPreview, listener),
    onHostStatusChanged: (listener) =>
      subscribe(networkIpcChannels.hostStatusChanged, listener),
    onMapPing: (listener) =>
      subscribe(networkIpcChannels.mapPing, listener),
    onMeasurementUpdate: (listener) =>
      subscribe(networkIpcChannels.measurementUpdate, listener),
    onSessionClosed: (listener) =>
      subscribe(networkIpcChannels.sessionClosed, listener),
    onTransformCancelled: (listener) =>
      subscribe(networkIpcChannels.transformCancelled, listener),
    onTransformPreview: (listener) =>
      subscribe(networkIpcChannels.transformPreview, listener),
    onTransformStarted: (listener) =>
      subscribe(networkIpcChannels.transformStarted, listener),
    openHost: (input) =>
      ipc.invoke(networkIpcChannels.openHost, input) as ReturnType<
        NetworkApi['openHost']
      >,
    resetPassword: (input) =>
      ipc.invoke(networkIpcChannels.resetPassword, input) as ReturnType<
        NetworkApi['resetPassword']
      >,
    sendChatMessage: (input) =>
      ipc.invoke(
        networkIpcChannels.sendChatMessage,
        input,
      ) as ReturnType<NetworkApi['sendChatMessage']>,
    setMaxChatMessageCharacters: (input) =>
      ipc.invoke(
        networkIpcChannels.setMaxChatMessageCharacters,
        input,
      ) as ReturnType<NetworkApi['setMaxChatMessageCharacters']>,
    setPort: (input) =>
      ipc.invoke(networkIpcChannels.setPort, input) as ReturnType<
        NetworkApi['setPort']
      >,
    setTransformPreviewRate: (input) =>
      ipc.invoke(networkIpcChannels.setTransformPreviewRate, input) as ReturnType<
        NonNullable<NetworkApi['setTransformPreviewRate']>
      >,
    sendMapPing: (input) =>
      ipc.invoke(networkIpcChannels.sendMapPing, input) as Promise<void>,
    sendDrawingPreview: (input) =>
      ipc.invoke(
        networkIpcChannels.sendDrawingPreview,
        input,
      ) as Promise<void>,
    sendMeasurementUpdate: (input) =>
      ipc.invoke(
        networkIpcChannels.sendMeasurementUpdate,
        input,
      ) as Promise<void>,
    stopHost: () =>
      ipc.invoke(networkIpcChannels.stopHost) as Promise<void>,
    updateUsername: (input) =>
      ipc.invoke(networkIpcChannels.updateUsername, input) as ReturnType<
        NetworkApi['updateUsername']
      >,
  };
}
