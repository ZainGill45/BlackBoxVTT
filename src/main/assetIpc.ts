import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import {
  assetIpcChannels,
  type AssetResult,
} from '../shared/assets';
import type { AssetManager } from './assetManager';

const campaignSchema = z.object({ campaignId: z.string().uuid() }).strict();
const assetSchema = campaignSchema.extend({
  assetId: z.string().uuid(),
});
const renameSchema = assetSchema.extend({
  displayName: z.string(),
  expectedRevision: z.number().int().nonnegative(),
});
const trashSchema = assetSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
});
const releaseSchema = z.object({ token: z.string().uuid() }).strict();

function invalid<T>(): AssetResult<T> {
  return {
    error: {
      code: 'invalid_input',
      message: 'The asset request contains invalid input.',
    },
    ok: false,
  };
}

export function registerAssetIpcHandlers(
  ipc: IpcMain,
  manager: AssetManager,
  getAllowedWebContents: () => WebContents | null,
) {
  const requestChannels = [
    assetIpcChannels.getPreview,
    assetIpcChannels.list,
    assetIpcChannels.pickAndImport,
    assetIpcChannels.prepareRemote,
    assetIpcChannels.releasePreview,
    assetIpcChannels.rename,
    assetIpcChannels.trash,
  ];
  requestChannels.forEach((channel) => ipc.removeHandler(channel));
  const isAllowed = (event: IpcMainInvokeEvent) =>
    event.sender === getAllowedWebContents();
  const handle = (
    channel: string,
    listener: (input: unknown) => unknown,
  ) => {
    ipc.handle(channel, (event, input) =>
      isAllowed(event) ? listener(input) : invalid(),
    );
  };

  handle(assetIpcChannels.list, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success ? manager.list(parsed.data.campaignId) : invalid();
  });
  handle(assetIpcChannels.pickAndImport, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success
      ? manager.pickAndImport(parsed.data.campaignId)
      : invalid();
  });
  handle(assetIpcChannels.prepareRemote, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success
      ? manager.prepareRemote(parsed.data.campaignId)
      : invalid();
  });
  handle(assetIpcChannels.rename, (input) => {
    const parsed = renameSchema.safeParse(input);
    return parsed.success ? manager.rename(parsed.data) : invalid();
  });
  handle(assetIpcChannels.trash, (input) => {
    const parsed = trashSchema.safeParse(input);
    return parsed.success ? manager.trash(parsed.data) : invalid();
  });
  handle(assetIpcChannels.getPreview, (input) => {
    const parsed = assetSchema.safeParse(input);
    return parsed.success
      ? manager.getPreview(parsed.data.campaignId, parsed.data.assetId)
      : invalid();
  });
  handle(assetIpcChannels.releasePreview, (input) => {
    const parsed = releaseSchema.safeParse(input);
    if (parsed.success) {
      manager.releasePreview(parsed.data.token);
    }
  });

  const send = (channel: string, value: unknown) => {
    const webContents = getAllowedWebContents();
    if (webContents && !webContents.isDestroyed()) {
      webContents.send(channel, value);
    }
  };
  const onChanged = (event: unknown) => send(assetIpcChannels.changed, event);
  const onError = (event: unknown) => send(assetIpcChannels.error, event);
  const onProgress = (event: unknown) => send(assetIpcChannels.progress, event);
  manager.on('changed', onChanged);
  manager.on('error', onError);
  manager.on('progress', onProgress);

  return () => {
    requestChannels.forEach((channel) => ipc.removeHandler(channel));
    manager.off('changed', onChanged);
    manager.off('error', onError);
    manager.off('progress', onProgress);
  };
}
