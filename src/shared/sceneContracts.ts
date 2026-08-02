import { z } from 'zod';
import { MAX_SCENE_OBJECTS, SCENE_LAYERS } from './sceneConstants';
import {
  sceneObjectStateSchema,
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
  state: sceneObjectStateSchema,
});
const sceneArrangementTargetsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MAX_SCENE_OBJECTS)
  .refine(
    (targets) => new Set(targets).size === targets.length,
    'Arrangement targets must be unique.',
  );

export const sceneArrangementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      direction: z.enum(['back', 'backward', 'forward', 'front']),
      kind: z.literal('reorder'),
      targets: sceneArrangementTargetsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('move-layer'),
      targetLayer: z.enum(SCENE_LAYERS),
      targets: sceneArrangementTargetsSchema,
    })
    .strict(),
]);
export const setSceneObjectsInputSchema = setSceneImagesInputSchema.extend({
  arrangement: sceneArrangementSchema.optional(),
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
    .max(MAX_SCENE_OBJECTS),
  targets: z.array(z.string()).max(MAX_SCENE_OBJECTS),
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
export type SceneArrangement = z.infer<typeof sceneArrangementSchema>;
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
