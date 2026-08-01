import { z } from 'zod';
import {
  sceneImageStateSchema,
  sceneManifestSchema,
  sceneObjectTransformSchema,
  scenePatchSchema,
} from './sceneSchema';

export const sceneCampaignInputSchema = z
  .object({ campaignId: z.string().uuid() })
  .strict();
export const sceneAssetInputSchema = sceneCampaignInputSchema.extend({
  assetId: z.string().uuid(),
});
export const presentSceneInputSchema = sceneCampaignInputSchema.extend({
  sceneId: z.string().uuid().nullable(),
});
export const trashSceneInputSchema = sceneCampaignInputSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  sceneId: z.string().uuid(),
});
export const updateSceneInputSchema = trashSceneInputSchema.extend({
  patch: scenePatchSchema,
});
export const setSceneImagesInputSchema = trashSceneInputSchema.extend({
  state: sceneImageStateSchema,
});
export const setSceneObjectsInputSchema = setSceneImagesInputSchema.extend({
  operationId: z.string().uuid(),
});
export const sceneHistoryInputSchema = sceneCampaignInputSchema.extend({
  sceneId: z.string().uuid(),
});
export const sceneEditActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gm') }).strict(),
  z
    .object({ kind: z.literal('player'), userId: z.string().uuid() })
    .strict(),
]);
export const sceneTransformPreviewStartSchema = sceneCampaignInputSchema.extend({
  kind: z.enum(['move', 'nudge', 'resize', 'rotate']),
  operationId: z.string().uuid(),
  pivotX: z.number().finite(),
  pivotY: z.number().finite(),
  revision: z.number().int().nonnegative(),
  sceneId: z.string().uuid(),
  startingTransforms: z
    .array(
      z
        .object({
          id: z.string().min(1).max(128),
          transform: sceneObjectTransformSchema,
        })
        .strict(),
    )
    .max(2_049),
  targets: z.array(z.string()).max(2_049),
});
export const sceneTransformPreviewDeltaSchema = sceneCampaignInputSchema.extend({
  absolute: sceneObjectTransformSchema.optional(),
  dx: z.number().finite(),
  dy: z.number().finite(),
  operationId: z.string().uuid(),
  rotation: z.number().finite(),
  scaleX: z.number().finite().positive(),
  scaleY: z.number().finite().positive(),
});
export const sceneTransformPreviewCancelSchema = sceneCampaignInputSchema.extend({
  operationId: z.string().uuid(),
  sceneId: z.string().uuid(),
});
export const sceneChangedEventSchema = z
  .object({
    campaignId: z.string().uuid(),
    manifest: sceneManifestSchema,
  })
  .strict();

export type SceneCampaignInput = z.infer<typeof sceneCampaignInputSchema>;
export type SceneAssetInput = z.infer<typeof sceneAssetInputSchema>;
export type PresentSceneInput = z.infer<typeof presentSceneInputSchema>;
export type TrashSceneInput = z.infer<typeof trashSceneInputSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneInputSchema>;
export type SetSceneImagesInput = z.infer<typeof setSceneImagesInputSchema>;
export type SetSceneObjectsInput = z.infer<typeof setSceneObjectsInputSchema>;
export type SceneHistoryInput = z.infer<typeof sceneHistoryInputSchema>;
export type SceneEditActor = z.infer<typeof sceneEditActorSchema>;
export type SceneTransformPreviewStart = z.infer<
  typeof sceneTransformPreviewStartSchema
>;
export type SceneTransformPreviewDelta = z.infer<
  typeof sceneTransformPreviewDeltaSchema
>;
export type SceneTransformPreviewCancel = z.infer<
  typeof sceneTransformPreviewCancelSchema
>;
export type SceneChangedEvent = z.infer<typeof sceneChangedEventSchema>;
