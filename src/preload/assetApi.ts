import type { IpcRendererEvent } from 'electron';
import {
  assetIpcChannels,
  type AssetApi,
} from '../shared/assets';

interface AssetIpcRenderer {
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

export function createAssetApi(ipc: AssetIpcRenderer): AssetApi {
  const subscribe = <T>(channel: string, listener: (value: T) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown) =>
      listener(value as T);
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };

  return {
    getPreview: (input) =>
      ipc.invoke(assetIpcChannels.getPreview, input) as ReturnType<
        AssetApi['getPreview']
      >,
    list: (input) =>
      ipc.invoke(assetIpcChannels.list, input) as ReturnType<AssetApi['list']>,
    importImageBytes: (input) =>
      ipc.invoke(assetIpcChannels.importImageBytes, input) as ReturnType<
        AssetApi['importImageBytes']
      >,
    onChanged: (listener) =>
      subscribe(assetIpcChannels.changed, listener),
    onError: (listener) => subscribe(assetIpcChannels.error, listener),
    onProgress: (listener) => subscribe(assetIpcChannels.progress, listener),
    pickAndImport: (input) =>
      ipc.invoke(assetIpcChannels.pickAndImport, input) as ReturnType<
        AssetApi['pickAndImport']
      >,
    pickImages: (input) =>
      ipc.invoke(assetIpcChannels.pickImages, input) as ReturnType<
        AssetApi['pickImages']
      >,
    prepareRemote: (input) =>
      ipc.invoke(assetIpcChannels.prepareRemote, input) as ReturnType<
        AssetApi['prepareRemote']
      >,
    releasePreview: (input) =>
      ipc.invoke(assetIpcChannels.releasePreview, input) as Promise<void>,
    rename: (input) =>
      ipc.invoke(assetIpcChannels.rename, input) as ReturnType<
        AssetApi['rename']
      >,
    reorder: (input) =>
      ipc.invoke(assetIpcChannels.reorder, input) as ReturnType<
        AssetApi['reorder']
      >,
    trash: (input) =>
      ipc.invoke(assetIpcChannels.trash, input) as ReturnType<
        AssetApi['trash']
      >,
  };
}
