import type { IpcRendererEvent } from 'electron';
import { sceneIpcChannels, type SceneApi } from '../shared/scenes';

interface SceneIpcRenderer {
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

export function createSceneApi(ipc: SceneIpcRenderer): SceneApi {
  const subscribe = <T>(channel: string, listener: (value: T) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown) =>
      listener(value as T);
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };

  return {
    create: (input) =>
      ipc.invoke(sceneIpcChannels.create, input) as ReturnType<
        SceneApi['create']
      >,
    detachAsset: (input) =>
      ipc.invoke(sceneIpcChannels.detachAsset, input) as ReturnType<
        SceneApi['detachAsset']
      >,
    findDependents: (input) =>
      ipc.invoke(sceneIpcChannels.findDependents, input) as ReturnType<
        SceneApi['findDependents']
      >,
    list: (input) =>
      ipc.invoke(sceneIpcChannels.list, input) as ReturnType<SceneApi['list']>,
    onChanged: (listener) => subscribe(sceneIpcChannels.changed, listener),
    present: (input) =>
      ipc.invoke(sceneIpcChannels.present, input) as ReturnType<
        SceneApi['present']
      >,
    previewCancel: (input) =>
      ipc.invoke(sceneIpcChannels.previewCancel, input) as Promise<void>,
    previewStart: (input) =>
      ipc.invoke(sceneIpcChannels.previewStart, input) as Promise<void>,
    previewUpdate: (input) =>
      ipc.invoke(sceneIpcChannels.previewUpdate, input) as Promise<void>,
    redo: (input) =>
      ipc.invoke(sceneIpcChannels.redo, input) as ReturnType<
        NonNullable<SceneApi['redo']>
      >,
    setImages: (input) =>
      ipc.invoke(sceneIpcChannels.setImages, input) as ReturnType<
        NonNullable<SceneApi['setImages']>
      >,
    setObjects: (input) =>
      ipc.invoke(sceneIpcChannels.setObjects, input) as ReturnType<
        NonNullable<SceneApi['setObjects']>
      >,
    trash: (input) =>
      ipc.invoke(sceneIpcChannels.trash, input) as ReturnType<
        SceneApi['trash']
      >,
    update: (input) =>
      ipc.invoke(sceneIpcChannels.update, input) as ReturnType<
        SceneApi['update']
      >,
    undo: (input) =>
      ipc.invoke(sceneIpcChannels.undo, input) as ReturnType<
        NonNullable<SceneApi['undo']>
      >,
  };
}
