import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { sceneIpcChannels, type SceneResult } from '../shared/scenes';
import type { SceneManager } from './sceneManager';
import {
  presentSceneInputSchema as presentSchema,
  sceneAssetInputSchema as assetSchema,
  sceneCampaignInputSchema as campaignSchema,
  sceneHistoryInputSchema as historySchema,
  sceneTransformPreviewCancelSchema as previewCancelSchema,
  sceneTransformPreviewDeltaSchema as previewUpdateSchema,
  sceneTransformPreviewStartSchema as previewStartSchema,
  setSceneImagesInputSchema as setImagesSchema,
  setSceneObjectsInputSchema as setObjectsSchema,
  setSceneFogInputSchema as setFogSchema,
  trashSceneInputSchema as trashSchema,
  updateSceneInputSchema as updateSchema,
} from '../shared/sceneContracts';

function invalid<T>(): SceneResult<T> {
  return {
    error: {
      code: 'invalid_input',
      message: 'The scene request contains invalid input.',
    },
    ok: false,
  };
}

export function registerSceneIpcHandlers(
  ipc: IpcMain,
  manager: SceneManager,
  getAllowedWebContents: () => WebContents | null,
) {
  const requestChannels = [
    sceneIpcChannels.create,
    sceneIpcChannels.detachAsset,
    sceneIpcChannels.findDependents,
    sceneIpcChannels.list,
    sceneIpcChannels.present,
    sceneIpcChannels.previewCancel,
    sceneIpcChannels.previewStart,
    sceneIpcChannels.previewUpdate,
    sceneIpcChannels.redo,
    sceneIpcChannels.setImages,
    sceneIpcChannels.setObjects,
    sceneIpcChannels.setFog,
    sceneIpcChannels.trash,
    sceneIpcChannels.undo,
    sceneIpcChannels.update,
  ];
  requestChannels.forEach((channel) => ipc.removeHandler(channel));
  const isAllowed = (event: IpcMainInvokeEvent) =>
    event.sender === getAllowedWebContents();
  const handle = (channel: string, listener: (input: unknown) => unknown) => {
    ipc.handle(channel, (event, input) =>
      isAllowed(event) ? listener(input) : invalid(),
    );
  };

  handle(sceneIpcChannels.list, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success ? manager.list(parsed.data.campaignId) : invalid();
  });
  handle(sceneIpcChannels.create, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success ? manager.create(parsed.data.campaignId) : invalid();
  });
  handle(sceneIpcChannels.update, (input) => {
    const parsed = updateSchema.safeParse(input);
    return parsed.success ? manager.update(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.setImages, (input) => {
    const parsed = setImagesSchema.safeParse(input);
    return parsed.success ? manager.setImages(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.setObjects, (input) => {
    const parsed = setObjectsSchema.safeParse(input);
    return parsed.success ? manager.setObjects(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.setFog, (input) => {
    const parsed = setFogSchema.safeParse(input);
    return parsed.success ? manager.setFog(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.undo, (input) => {
    const parsed = historySchema.safeParse(input);
    return parsed.success ? manager.undo(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.redo, (input) => {
    const parsed = historySchema.safeParse(input);
    return parsed.success ? manager.redo(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.previewStart, (input) => {
    const parsed = previewStartSchema.safeParse(input);
    if (parsed.success) {
      return manager.previewStart(parsed.data);
    }
    return undefined;
  });
  handle(sceneIpcChannels.previewUpdate, (input) => {
    const parsed = previewUpdateSchema.safeParse(input);
    if (parsed.success) {
      return manager.previewUpdate(parsed.data);
    }
    return undefined;
  });
  handle(sceneIpcChannels.previewCancel, (input) => {
    const parsed = previewCancelSchema.safeParse(input);
    if (parsed.success) {
      return manager.previewCancel(parsed.data);
    }
    return undefined;
  });
  handle(sceneIpcChannels.trash, (input) => {
    const parsed = trashSchema.safeParse(input);
    return parsed.success ? manager.trash(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.present, (input) => {
    const parsed = presentSchema.safeParse(input);
    return parsed.success ? manager.present(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.findDependents, (input) => {
    const parsed = assetSchema.safeParse(input);
    return parsed.success ? manager.findDependents(parsed.data) : invalid();
  });
  handle(sceneIpcChannels.detachAsset, (input) => {
    const parsed = assetSchema.safeParse(input);
    return parsed.success ? manager.detachAsset(parsed.data) : invalid();
  });

  const onChanged = (event: unknown) => {
    const webContents = getAllowedWebContents();
    if (webContents && !webContents.isDestroyed()) {
      webContents.send(sceneIpcChannels.changed, event);
    }
  };
  manager.on('changed', onChanged);

  return () => {
    requestChannels.forEach((channel) => ipc.removeHandler(channel));
    manager.off('changed', onChanged);
  };
}
