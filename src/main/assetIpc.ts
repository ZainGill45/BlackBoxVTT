import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import {
  assetIpcChannels,
  MAX_ASSET_PERMISSION_OVERRIDES,
  MAX_EMBEDDED_IMAGE_BYTES,
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
/* Extends campaignSchema, not assetSchema: reordering names a kind group
   rather than a single asset. */
const reorderSchema = campaignSchema.extend({
  kind: z.enum(['audio', 'document', 'image']),
  orderedAssetIds: z.array(z.string().uuid()).max(10_000),
});
const releaseSchema = z.object({ token: z.string().uuid() }).strict();
const assetAccessSchema = z.enum(['none', 'view', 'edit']);
const updatePermissionsSchema = assetSchema.extend({
  expectedPermissionRevision: z.number().int().nonnegative(),
  permissions: z.object({
    allPlayers: assetAccessSchema,
    overrides: z
      .array(
        z.object({ access: assetAccessSchema, userId: z.string().uuid() }).strict(),
      )
      .max(MAX_ASSET_PERMISSION_OVERRIDES),
  }).strict(),
}).strict();
const importImageSchema = campaignSchema.extend({
  bytesBase64: z.string().max(Math.ceil((MAX_EMBEDDED_IMAGE_BYTES * 4) / 3) + 8),
  filename: z.string().min(1).max(512),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
});

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
    assetIpcChannels.importImageBytes,
    assetIpcChannels.list,
    assetIpcChannels.pickAndImport,
    assetIpcChannels.pickImages,
    assetIpcChannels.prepareRemote,
    assetIpcChannels.releasePreview,
    assetIpcChannels.rename,
    assetIpcChannels.reorder,
    assetIpcChannels.trash,
    assetIpcChannels.listUsers,
    assetIpcChannels.updatePermissions,
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
  handle(assetIpcChannels.pickImages, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success ? manager.pickImages(parsed.data.campaignId) : invalid();
  });
  handle(assetIpcChannels.importImageBytes, (input) => {
    const parsed = importImageSchema.safeParse(input);
    return parsed.success ? manager.importImageBytes(parsed.data) : invalid();
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
  handle(assetIpcChannels.reorder, (input) => {
    const parsed = reorderSchema.safeParse(input);
    return parsed.success ? manager.reorder(parsed.data) : invalid();
  });
  handle(assetIpcChannels.trash, (input) => {
    const parsed = trashSchema.safeParse(input);
    return parsed.success ? manager.trash(parsed.data) : invalid();
  });
  handle(assetIpcChannels.listUsers, (input) => {
    const parsed = campaignSchema.safeParse(input);
    return parsed.success ? manager.listUsers(parsed.data.campaignId) : invalid();
  });
  handle(assetIpcChannels.updatePermissions, (input) => {
    const parsed = updatePermissionsSchema.safeParse(input);
    return parsed.success ? manager.updatePermissions(parsed.data) : invalid();
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
