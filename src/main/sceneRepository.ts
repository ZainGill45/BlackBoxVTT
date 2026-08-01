import { randomUUID } from 'node:crypto';
import {
  createDefaultGrid,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptySceneManifest,
  DRAWING_LOCK_TIMEOUT_MS,
  imageStateOf,
  MAX_DRAWING_HISTORY,
  DEFAULT_SCENE_DISTANCE,
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_NAME,
  DEFAULT_SCENE_PIXEL_SCALE,
  DEFAULT_SCENE_UNIT,
  DEFAULT_SCENE_WIDTH,
  normalizeSceneName,
  sceneBounds,
  type ScenePatch,
  type SceneDrawing,
  type SceneDrawingLayer,
  type SceneEditActor,
  type SceneErrorCode,
  type SceneManifest,
  type SceneImageState,
  type SceneImage,
  type SceneRecord,
  type SceneResult,
} from '../shared/scenes';
import {
  sceneImageStateSchema,
  sceneManifestSchema,
  sceneRecordSchema,
} from '../shared/sceneSchema';
import { fail } from '../shared/result';
import { CampaignDatabase } from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';

const MAX_SCENES = 1024;
const MAX_DURABLE_SCENE_OPERATIONS = 2_048;

interface SceneRepositoryOptions {
  createId?: () => string;
  database: CampaignDatabase;
  now?: () => Date;
  touchCampaign?: () => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}

function failure<T>(
  code: SceneErrorCode,
  message: string,
  sceneId?: string,
): SceneResult<T> {
  return fail({ code, message, sceneId });
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function normalizeImageTransform<
  T extends {
    height: number;
    rotation: number;
    width: number;
    x: number;
    y: number;
  },
>(image: T): T {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const rotation = round(((image.rotation % 360) + 360) % 360);
  return {
    ...image,
    height: Math.max(1, round(image.height)),
    rotation: rotation >= 360 ? 0 : rotation,
    width: Math.max(1, round(image.width)),
    x: round(image.x),
    y: round(image.y),
  };
}

type SceneObjectSnapshot =
  | {
      index: number;
      kind: 'drawing';
      layer: SceneDrawingLayer;
      value: SceneDrawing;
    }
  | {
      index: number;
      kind: 'image';
      layer: SceneDrawingLayer;
      value: SceneImage;
    }
  | {
      kind: 'map-image';
      value: NonNullable<SceneImageState['mapImage']>;
    }
  | null;

interface SceneHistoryCommand {
  changes: Array<{
    expected: SceneObjectSnapshot;
    id: string;
    target: SceneObjectSnapshot;
  }>;
  sceneId: string;
}

interface CompletedSceneOperation {
  actorKey: string;
  operationId: string;
  sceneId: string;
}

interface SceneObjectLock {
  actor: string;
  expiresAt: number;
  operationId: string;
}

function actorKey(actor: SceneEditActor): string {
  return actor.kind === 'gm' ? 'gm' : `player:${actor.userId}`;
}

function drawingOwner(actor: SceneEditActor): string | null {
  return actor.kind === 'gm' ? null : actor.userId;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeDrawing(drawing: SceneDrawing): SceneDrawing {
  const rotation = round(((drawing.rotation % 360) + 360) % 360);
  return {
    ...structuredClone(drawing),
    closed: drawing.kind === 'polyline' && drawing.closed,
    points: drawing.points.map((point) => ({
      x: round(point.x),
      y: round(point.y),
    })),
    rotation: rotation >= 360 ? 0 : rotation,
    scaleX: Math.max(0.001, round(drawing.scaleX)),
    scaleY: Math.max(0.001, round(drawing.scaleY)),
    style: {
      ...drawing.style,
      fillEnabled:
        drawing.kind === 'polyline' &&
        drawing.closed &&
        drawing.style.fillEnabled,
      fillOpacity: round(drawing.style.fillOpacity),
      hardness: round(drawing.style.hardness),
      strokeOpacity: round(drawing.style.strokeOpacity),
      strokeWidth: round(drawing.style.strokeWidth),
    },
    x: round(drawing.x),
    y: round(drawing.y),
  };
}

function withoutDrawingRevision(drawing: SceneDrawing): Omit<SceneDrawing, 'revision'> {
  return Object.fromEntries(
    Object.entries(drawing).filter(([key]) => key !== 'revision'),
  ) as Omit<SceneDrawing, 'revision'>;
}

function sameDrawing(
  left: SceneDrawing,
  right: SceneDrawing,
): boolean {
  return JSON.stringify(withoutDrawingRevision(left)) ===
    JSON.stringify(withoutDrawingRevision(right));
}

function sameSnapshot(
  left: SceneObjectSnapshot,
  right: SceneObjectSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotMap(state: SceneImageState): Map<string, SceneObjectSnapshot> {
  const snapshots = new Map<string, SceneObjectSnapshot>();
  if (state.mapImage) {
    snapshots.set('canonical-map', {
      kind: 'map-image',
      value: structuredClone(state.mapImage),
    });
  }
  for (const layer of ['map', 'token', 'gm'] as SceneDrawingLayer[]) {
    state.images[layer].forEach((image, index) => {
      snapshots.set(image.id, {
        index,
        kind: 'image',
        layer,
        value: structuredClone(image),
      });
    });
    state.drawings[layer].forEach((drawing, index) => {
      snapshots.set(drawing.id, {
        index,
        kind: 'drawing',
        layer,
        value: structuredClone(drawing),
      });
    });
  }
  return snapshots;
}

function snapshotChanges(
  before: SceneImageState,
  after: SceneImageState,
): SceneHistoryCommand['changes'] {
  const beforeMap = snapshotMap(before);
  const afterMap = snapshotMap(after);
  return [...new Set([...beforeMap.keys(), ...afterMap.keys()])]
    .map((id) => ({
      after: afterMap.get(id) ?? null,
      before: beforeMap.get(id) ?? null,
      id,
    }))
    .filter(({ after, before }) => !sameSnapshot(before, after))
    .map(({ after, before, id }) => ({
      expected: after,
      id,
      target: before,
    }));
}

function removeObject(state: SceneImageState, id: string): void {
  if (id === 'canonical-map') {
    state.mapImage = null;
  }
  for (const layer of ['map', 'token', 'gm'] as SceneDrawingLayer[]) {
    state.images[layer] = state.images[layer].filter((image) => image.id !== id);
    state.drawings[layer] = state.drawings[layer].filter(
      (drawing) => drawing.id !== id,
    );
  }
}

function insertSnapshot(
  state: SceneImageState,
  snapshot: SceneObjectSnapshot,
  nextDrawingRevision: number,
): void {
  if (!snapshot) {
    return;
  }
  if (snapshot.kind === 'map-image') {
    state.mapImage = structuredClone(snapshot.value);
    return;
  }
  if (snapshot.kind === 'drawing') {
    const value = structuredClone(snapshot.value);
    value.revision = nextDrawingRevision;
    state.drawings[snapshot.layer].splice(
      Math.min(snapshot.index, state.drawings[snapshot.layer].length),
      0,
      value,
    );
  } else {
    const value = structuredClone(snapshot.value);
    state.images[snapshot.layer].splice(
      Math.min(snapshot.index, state.images[snapshot.layer].length),
      0,
      value,
    );
  }
}

export class SceneRepository {
  private readonly database: CampaignDatabase;
  private readonly createId: () => string;
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private readonly objectLocks = new Map<string, SceneObjectLock>();
  private readonly redoStacks = new Map<string, SceneHistoryCommand[]>();
  private readonly touchCampaign?: () => Promise<void>;
  private readonly undoStacks = new Map<string, SceneHistoryCommand[]>();
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    createId = randomUUID,
    database,
    now = () => new Date(),
    touchCampaign,
    warn = console.warn,
  }: SceneRepositoryOptions) {
    this.database = database;
    this.createId = createId;
    this.now = now;
    this.touchCampaign = touchCampaign;
    this.warn = warn;
  }

  /**
   * A missing or malformed manifest resolves to an empty one rather than an
   * error, matching how CampaignRepository tolerates unreadable containers.
   */
  async readManifest(): Promise<SceneManifest> {
    try {
      const state = this.database.connection
        .prepare(
          `SELECT active_scene_id, revision
           FROM scene_manifest
           WHERE singleton = 1`,
        )
        .get() as
        | { active_scene_id: string | null; revision: number }
        | undefined;
      if (!state) {
        throw new Error('Scene manifest state is missing.');
      }
      const records = this.database.connection
        .prepare(
          `SELECT id, record_json
           FROM scenes
           ORDER BY position`,
        )
        .all() as unknown as Array<{ id: string; record_json: string }>;
      const parsed = sceneManifestSchema.parse({
        activeSceneId: state.active_scene_id,
        revision: state.revision,
        scenes: records.map((row) => {
          const scene = sceneRecordSchema.parse(JSON.parse(row.record_json));
          if (scene.id !== row.id) {
            throw new Error('Scene row ID does not match its record.');
          }
          return scene;
        }),
        schemaVersion: createEmptySceneManifest().schemaVersion,
      });
      return this.reconcile(parsed);
    } catch (error) {
      this.warn('Failed to read the scene manifest.', error);
      return createEmptySceneManifest();
    }
  }

  async list(): Promise<SceneResult<SceneManifest>> {
    return { ok: true, value: await this.readManifest() };
  }

  create(): Promise<SceneResult<SceneRecord>> {
    return this.mutate(async (manifest) => {
      if (manifest.scenes.length >= MAX_SCENES) {
        return failure('storage_error', 'This campaign cannot hold more scenes.');
      }
      const timestamp = this.now().toISOString();
      const scene: SceneRecord = {
        createdAt: timestamp,
        distance: DEFAULT_SCENE_DISTANCE,
        grid: createDefaultGrid(),
        height: DEFAULT_SCENE_HEIGHT,
        id: this.createId(),
        drawings: createEmptyDrawingLayers(),
        images: createEmptyImageLayers(),
        mapImage: null,
        name: DEFAULT_SCENE_NAME,
        pixelScale: DEFAULT_SCENE_PIXEL_SCALE,
        revision: 0,
        unit: DEFAULT_SCENE_UNIT,
        updatedAt: timestamp,
        width: DEFAULT_SCENE_WIDTH,
      };
      return {
        manifest: { ...manifest, scenes: [...manifest.scenes, scene] },
        result: { ok: true, value: scene },
      };
    });
  }

  setImages(
    sceneId: string,
    state: SceneImageState,
    expectedRevision: number,
  ): Promise<SceneResult<SceneRecord>> {
    return this.setObjects(
      sceneId,
      state,
      expectedRevision,
      this.createId(),
      { kind: 'gm' },
    );
  }

  setObjects(
    sceneId: string,
    state: SceneImageState,
    expectedRevision: number,
    operationId: string,
    actor: SceneEditActor,
  ): Promise<SceneResult<SceneRecord>> {
    return this.mutate(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      const completedOperation: CompletedSceneOperation = {
        actorKey: actorKey(actor),
        operationId,
        sceneId,
      };
      let alreadyCompleted: boolean;
      try {
        alreadyCompleted = this.hasCompletedOperation(completedOperation);
      } catch (error) {
        this.warn('Failed to read durable scene operation state.', error);
        return failure('storage_error', 'The scene could not be saved.', sceneId);
      }
      if (alreadyCompleted) {
        // A retry may arrive after other participants have committed. Return
        // the current authoritative scene while preserving idempotency rather
        // than handing the retrier an obsolete snapshot.
        return { ok: true, value: current };
      }
      // Receiving a durable commit ends this transform operation regardless
      // of whether validation accepts the mutation. The repository mutation
      // queue keeps the validation/write atomic, so retaining the actor's own
      // lock here only strands the object after a rejected commit.
      this.releaseOperationLocks(actor, operationId);
      if (actor.kind === 'gm' && current.revision !== expectedRevision) {
        return failure(
          'conflict',
          'The scene changed somewhere else. Reopen it and try again.',
          sceneId,
        );
      }
      if (
        actor.kind === 'player' &&
        current.revision !== expectedRevision
      ) {
        const requestedIds = new Set(
          Object.values(state.drawings)
            .flat()
            .map((drawing) => drawing.id),
        );
        const deletesExisting = Object.values(current.drawings)
          .flat()
          .some(
            (drawing) =>
              drawing.ownerId === actor.userId &&
              !requestedIds.has(drawing.id),
          );
        if (deletesExisting) {
          return failure(
            'conflict',
            'The scene changed before the deletion could be applied.',
            sceneId,
          );
        }
      }
      const prepared = this.prepareObjectState(current, state, actor);
      if (!prepared.ok) {
        return prepared;
      }
      const normalizedState = prepared.value;
      const parsed = sceneImageStateSchema.safeParse(normalizedState);
      if (!parsed.success) {
        return failure(
          'invalid_input',
          'The scene object state is invalid or outside the supported safety bounds.',
          sceneId,
        );
      }
      const before = imageStateOf(current);
      const changes = snapshotChanges(before, parsed.data);
      const lockConflict = changes.some(({ id }) =>
        this.isLockedByAnother(sceneId, id, actor, operationId),
      );
      if (lockConflict) {
        return failure(
          'conflict',
          'One or more selected objects are being edited by someone else.',
          sceneId,
        );
      }
      if (changes.length === 0) {
        this.releaseOperationLocks(actor, operationId);
        try {
          this.rememberOperation(completedOperation);
        } catch (error) {
          this.warn('Failed to store durable scene operation state.', error);
          return failure(
            'storage_error',
            'The scene could not be saved.',
            sceneId,
          );
        }
        return { ok: true, value: current };
      }
      const next: SceneRecord = {
        ...current,
        ...parsed.data,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
      };
      this.recordHistory(actor, {
        changes,
        sceneId,
      });
      this.releaseOperationLocks(actor, operationId);
      return {
        completedOperation,
        manifest: {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        },
        result: { ok: true, value: next },
      };
    });
  }

  beginTransform(
    sceneId: string,
    operationId: string,
    targets: string[],
    actor: SceneEditActor,
  ): Promise<SceneResult<null>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const scene = manifest.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      this.expireLocks();
      const stateTargets = snapshotMap(imageStateOf(scene));
      const uniqueTargets = [...new Set(targets)];
      if (
        uniqueTargets.length === 0 ||
        uniqueTargets.some((id) => !stateTargets.has(id))
      ) {
        return failure('invalid_input', 'The transform target is invalid.', sceneId);
      }
      if (
        actor.kind === 'player' &&
        uniqueTargets.some((id) => {
          const snapshot = stateTargets.get(id);
          return (
            snapshot?.kind !== 'drawing' ||
            snapshot.value.ownerId !== actor.userId
          );
        })
      ) {
        return failure(
          'permission_denied',
          'Players can transform only their own drawings.',
          sceneId,
        );
      }
      if (
        uniqueTargets.some((id) =>
          this.isLockedByAnother(sceneId, id, actor, operationId),
        )
      ) {
        return failure(
          'conflict',
          'One or more selected objects are being edited by someone else.',
          sceneId,
        );
      }
      const expiresAt = Date.now() + DRAWING_LOCK_TIMEOUT_MS;
      for (const id of uniqueTargets) {
        this.objectLocks.set(`${sceneId}:${id}`, {
          actor: actorKey(actor),
          expiresAt,
          operationId,
        });
      }
      return { ok: true, value: null };
    });
  }

  refreshTransform(
    operationId: string,
    actor: SceneEditActor,
  ): void {
    const expiresAt = Date.now() + DRAWING_LOCK_TIMEOUT_MS;
    const key = actorKey(actor);
    for (const lock of this.objectLocks.values()) {
      if (lock.actor === key && lock.operationId === operationId) {
        lock.expiresAt = expiresAt;
      }
    }
  }

  cancelTransform(operationId: string, actor: SceneEditActor): void {
    this.releaseOperationLocks(actor, operationId);
  }

  undo(
    sceneId: string,
    actor: SceneEditActor,
  ): Promise<SceneResult<SceneRecord>> {
    return this.applyHistory(sceneId, actor, false);
  }

  redo(
    sceneId: string,
    actor: SceneEditActor,
  ): Promise<SceneResult<SceneRecord>> {
    return this.applyHistory(sceneId, actor, true);
  }

  update(
    sceneId: string,
    patch: ScenePatch,
    expectedRevision: number,
  ): Promise<SceneResult<SceneRecord>> {
    return this.mutate(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      if (current.revision !== expectedRevision) {
        return failure(
          'conflict',
          'The scene changed somewhere else. Reopen it and try again.',
          sceneId,
        );
      }

      const name =
        patch.name === undefined ? current.name : normalizeSceneName(patch.name);
      if (
        name.length < sceneBounds.name.min ||
        name.length > sceneBounds.name.max
      ) {
        return failure(
          'invalid_input',
          `A scene name must be between ${sceneBounds.name.min} and ${sceneBounds.name.max} characters.`,
          sceneId,
        );
      }

      // Assigned field by field so an explicit `undefined` on the patch cannot
      // erase a value the caller never meant to touch.
      const next: SceneRecord = {
        ...current,
        distance: patch.distance ?? current.distance,
        grid: { ...current.grid, ...stripUndefined(patch.grid) },
        height: patch.height ?? current.height,
        mapImage:
          patch.mapImage === undefined
            ? current.mapImage
            : patch.mapImage
              ? normalizeImageTransform(patch.mapImage)
              : null,
        name,
        pixelScale: patch.pixelScale ?? current.pixelScale,
        revision: current.revision + 1,
        unit: patch.unit ?? current.unit,
        updatedAt: this.now().toISOString(),
        width: patch.width ?? current.width,
      };
      const parsed = sceneRecordSchema.safeParse(next);
      if (!parsed.success) {
        return failure(
          'invalid_input',
          'The scene settings are invalid or outside the supported safety bounds.',
          sceneId,
        );
      }

      return {
        manifest: {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? parsed.data : scene,
          ),
        },
        result: { ok: true, value: parsed.data },
      };
    });
  }

  trash(
    sceneId: string,
    expectedRevision: number,
  ): Promise<SceneResult<null>> {
    return this.mutate(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      if (current.revision !== expectedRevision) {
        return failure(
          'conflict',
          'The scene changed somewhere else. Reopen it and try again.',
          sceneId,
        );
      }
      return {
        manifest: {
          ...manifest,
          activeSceneId:
            manifest.activeSceneId === sceneId ? null : manifest.activeSceneId,
          scenes: manifest.scenes.filter((scene) => scene.id !== sceneId),
        },
        result: { ok: true, value: null },
      };
    });
  }

  present(sceneId: string | null): Promise<SceneResult<SceneManifest>> {
    return this.mutate(async (manifest) => {
      if (sceneId && !manifest.scenes.some((scene) => scene.id === sceneId)) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      if (manifest.activeSceneId === sceneId) {
        return { ok: true, value: manifest };
      }
      const next = { ...manifest, activeSceneId: sceneId };
      return { manifest: next, result: { ok: true, value: next } };
    });
  }

  /** Clears the map image from every scene that references the asset. */
  detachAsset(assetId: string): Promise<SceneResult<null>> {
    return this.mutate(async (manifest) => {
      const depends = (scene: SceneRecord) =>
        scene.mapImage?.assetId === assetId ||
        Object.values(scene.images).some((layer: SceneImage[]) =>
          layer.some((image) => image.assetId === assetId),
        );
      const dependents = manifest.scenes.filter(depends);
      if (dependents.length === 0) {
        return { ok: true, value: null };
      }
      const timestamp = this.now().toISOString();
      return {
        manifest: {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            depends(scene)
              ? {
                  ...scene,
                  images: {
                    gm: scene.images.gm.filter((image) => image.assetId !== assetId),
                    map: scene.images.map.filter((image) => image.assetId !== assetId),
                    token: scene.images.token.filter((image) => image.assetId !== assetId),
                  },
                  mapImage:
                    scene.mapImage?.assetId === assetId ? null : scene.mapImage,
                  revision: scene.revision + 1,
                  updatedAt: timestamp,
                }
              : scene,
          ),
        },
        result: { ok: true, value: null },
      };
    });
  }

  async findDependents(assetId: string): Promise<SceneResult<SceneRecord[]>> {
    const manifest = await this.readManifest();
    return {
      ok: true,
      value: manifest.scenes.filter(
        (scene) =>
          scene.mapImage?.assetId === assetId ||
          Object.values(scene.images).some((layer: SceneImage[]) =>
            layer.some((image) => image.assetId === assetId),
          ),
      ),
    };
  }

  private prepareObjectState(
    current: SceneRecord,
    requested: SceneImageState,
    actor: SceneEditActor,
  ): SceneResult<SceneImageState> {
    const currentState = imageStateOf(current);
    const currentDrawings = new Map(
      Object.values(current.drawings)
        .flat()
        .map((drawing) => [drawing.id, drawing]),
    );
    if (actor.kind === 'gm') {
      const drawings = createEmptyDrawingLayers();
      for (const layer of ['map', 'token', 'gm'] as SceneDrawingLayer[]) {
        drawings[layer] = requested.drawings[layer].map((candidate) => {
          const existing = currentDrawings.get(candidate.id);
          const normalized = normalizeDrawing({
            ...candidate,
            ownerId: existing?.ownerId ?? drawingOwner(actor),
          });
          return {
            ...normalized,
            revision: existing
              ? sameDrawing(existing, normalized)
                ? existing.revision
                : existing.revision + 1
              : 0,
          };
        });
      }
      return {
        ok: true,
        value: {
          drawings,
          images: {
            gm: requested.images.gm.map(normalizeImageTransform),
            map: requested.images.map.map(normalizeImageTransform),
            token: requested.images.token.map(normalizeImageTransform),
          },
          mapImage: requested.mapImage
            ? normalizeImageTransform(requested.mapImage)
            : null,
        },
      };
    }

    const requestedDrawings = new Map<
      string,
      { drawing: SceneDrawing; layer: SceneDrawingLayer }
    >();
    for (const layer of ['map', 'token', 'gm'] as SceneDrawingLayer[]) {
      for (const drawing of requested.drawings[layer]) {
        requestedDrawings.set(drawing.id, { drawing, layer });
      }
    }
    const merged = structuredClone(currentState);
    for (const layer of ['map', 'token', 'gm'] as SceneDrawingLayer[]) {
      merged.drawings[layer] = merged.drawings[layer].filter(
        (drawing) => drawing.ownerId !== actor.userId,
      );
    }
    for (const [id, candidate] of requestedDrawings) {
      const existing = currentDrawings.get(id);
      if (existing && existing.ownerId !== actor.userId) {
        continue;
      }
      if (candidate.layer !== 'token') {
        return failure(
          'permission_denied',
          'Players can draw only on the public token layer.',
          current.id,
        );
      }
      if (
        existing &&
        candidate.drawing.revision !== existing.revision &&
        !sameDrawing(existing, candidate.drawing)
      ) {
        return failure(
          'conflict',
          'The drawing changed somewhere else. Try again.',
          current.id,
        );
      }
      const normalized = normalizeDrawing({
        ...candidate.drawing,
        ownerId: actor.userId,
      });
      merged.drawings.token.push({
        ...normalized,
        revision: existing
          ? sameDrawing(existing, normalized)
            ? existing.revision
            : existing.revision + 1
          : 0,
      });
    }
    return { ok: true, value: merged };
  }

  private historyKey(actor: SceneEditActor, sceneId: string): string {
    return `${actorKey(actor)}:${sceneId}`;
  }

  private recordHistory(
    actor: SceneEditActor,
    command: SceneHistoryCommand,
  ): void {
    const key = this.historyKey(actor, command.sceneId);
    const undo = this.undoStacks.get(key) ?? [];
    undo.push(command);
    this.undoStacks.set(key, undo.slice(-MAX_DRAWING_HISTORY));
    this.redoStacks.set(key, []);
  }

  private applyHistory(
    sceneId: string,
    actor: SceneEditActor,
    redo: boolean,
  ): Promise<SceneResult<SceneRecord>> {
    return this.mutate(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      const key = this.historyKey(actor, sceneId);
      const source = redo ? this.redoStacks : this.undoStacks;
      const destination = redo ? this.undoStacks : this.redoStacks;
      const stack = source.get(key) ?? [];
      const currentState = imageStateOf(current);
      const currentSnapshots = snapshotMap(currentState);
      let command: SceneHistoryCommand | undefined;
      while ((command = stack.pop())) {
        if (
          command.changes.every(({ expected, id }) =>
            sameSnapshot(currentSnapshots.get(id) ?? null, expected),
          )
        ) {
          break;
        }
        command = undefined;
      }
      source.set(key, stack);
      if (!command) {
        return { ok: true, value: current };
      }
      if (
        command.changes.some(({ id }) =>
          this.isLockedByAnother(sceneId, id, actor, ''),
        )
      ) {
        stack.push(command);
        return failure(
          'conflict',
          'An object in this history entry is being edited.',
          sceneId,
        );
      }
      const nextState = structuredClone(currentState);
      for (const change of command.changes) {
        removeObject(nextState, change.id);
      }
      const insertions = command.changes
        .filter(
          (change): change is typeof change & {
            target: Exclude<SceneObjectSnapshot, null>;
          } => change.target !== null,
        )
        .sort((left, right) => {
          const leftIndex = 'index' in left.target ? left.target.index : -1;
          const rightIndex = 'index' in right.target ? right.target.index : -1;
          return leftIndex - rightIndex;
        });
      for (const change of insertions) {
        const previous = command.changes.find(
          (candidate) => candidate.id === change.id,
        )?.expected;
        const currentRevision =
          previous?.kind === 'drawing' ? previous.value.revision : -1;
        const targetRevision =
          change.target.kind === 'drawing' ? change.target.value.revision : -1;
        insertSnapshot(
          nextState,
          change.target,
          Math.max(currentRevision, targetRevision) + 1,
        );
      }
      const parsed = sceneImageStateSchema.safeParse(nextState);
      if (!parsed.success) {
        return failure(
          'conflict',
          'The history entry can no longer be applied safely.',
          sceneId,
        );
      }
      const next: SceneRecord = {
        ...current,
        ...parsed.data,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
      };
      const appliedSnapshots = snapshotMap(parsed.data);
      const inverse: SceneHistoryCommand = {
        changes: command.changes.map(({ expected, id }) => ({
          expected: appliedSnapshots.get(id) ?? null,
          id,
          target: expected,
        })),
        sceneId,
      };
      const destinationStack = destination.get(key) ?? [];
      destinationStack.push(inverse);
      destination.set(
        key,
        destinationStack.slice(-MAX_DRAWING_HISTORY),
      );
      return {
        manifest: {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        },
        result: { ok: true, value: next },
      };
    });
  }

  private expireLocks(): void {
    const now = Date.now();
    for (const [id, lock] of this.objectLocks) {
      if (lock.expiresAt <= now) {
        this.objectLocks.delete(id);
      }
    }
  }

  private isLockedByAnother(
    sceneId: string,
    id: string,
    actor: SceneEditActor,
    operationId: string,
  ): boolean {
    this.expireLocks();
    const lock = this.objectLocks.get(`${sceneId}:${id}`);
    return Boolean(
      lock &&
        (lock.actor !== actorKey(actor) || lock.operationId !== operationId),
    );
  }

  private releaseOperationLocks(
    actor: SceneEditActor,
    operationId: string,
  ): void {
    const key = actorKey(actor);
    for (const [id, lock] of this.objectLocks) {
      if (lock.actor === key && lock.operationId === operationId) {
        this.objectLocks.delete(id);
      }
    }
  }

  private hasCompletedOperation(operation: CompletedSceneOperation): boolean {
    const row = this.database.connection
      .prepare(
        `SELECT 1 AS found
         FROM scene_operations
         WHERE actor_key = ? AND operation_id = ?`,
      )
      .get(operation.actorKey, operation.operationId) as
      | { found?: unknown }
      | undefined;
    return row?.found === 1;
  }

  private rememberOperation(operation: CompletedSceneOperation): void {
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      this.insertCompletedOperation(operation);
      this.pruneCompletedOperations();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Runs a mutation against the current manifest. Returning a `manifest` writes
   * it and bumps the manifest revision; returning a bare result writes nothing.
   */
  private mutate<T>(
    operation: (
      manifest: SceneManifest,
    ) => Promise<
      | SceneResult<T>
      | {
          completedOperation?: CompletedSceneOperation;
          manifest: SceneManifest;
          result: SceneResult<T>;
        }
    >,
  ): Promise<SceneResult<T>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const outcome = await operation(manifest);
      if (!('manifest' in outcome)) {
        return outcome;
      }
      try {
        await this.writeManifest(
          {
            ...outcome.manifest,
            revision: manifest.revision + 1,
          },
          outcome.completedOperation,
        );
      } catch (error) {
        this.warn('Failed to write the scene manifest.', error);
        return failure('storage_error', 'The scene could not be saved.');
      }
      if (this.touchCampaign) {
        try {
          await this.touchCampaign();
        } catch (error) {
          this.warn('Failed to touch the campaign after a scene change.', error);
        }
      }
      return outcome.result;
    });
  }

  private async writeManifest(
    manifest: SceneManifest,
    completedOperation?: CompletedSceneOperation,
  ): Promise<void> {
    const parsed = sceneManifestSchema.parse(manifest);
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('DELETE FROM scenes');
      const insert = database.prepare(
        `INSERT INTO scenes (id, position, record_json)
         VALUES (?, ?, ?)`,
      );
      parsed.scenes.forEach((scene, position) => {
        insert.run(scene.id, position, JSON.stringify(scene));
      });
      database
        .prepare(
          `UPDATE scene_manifest
           SET active_scene_id = ?, revision = ?
           WHERE singleton = 1`,
        )
        .run(parsed.activeSceneId, parsed.revision);
      if (completedOperation) {
        this.insertCompletedOperation(completedOperation);
        this.pruneCompletedOperations();
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertCompletedOperation(operation: CompletedSceneOperation): void {
    this.database.connection
      .prepare(
        `INSERT OR IGNORE INTO scene_operations (
           actor_key, operation_id, scene_id, completed_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        operation.actorKey,
        operation.operationId,
        operation.sceneId,
        this.now().toISOString(),
      );
  }

  private pruneCompletedOperations(): void {
    this.database.connection.exec(
      `DELETE FROM scene_operations
       WHERE sequence NOT IN (
         SELECT sequence
         FROM scene_operations
         ORDER BY sequence DESC
         LIMIT ${MAX_DURABLE_SCENE_OPERATIONS}
       )`,
    );
  }

  /** Drops an active scene id that no longer resolves to a scene. */
  private reconcile(manifest: SceneManifest): SceneManifest {
    if (
      manifest.activeSceneId &&
      !manifest.scenes.some((scene) => scene.id === manifest.activeSceneId)
    ) {
      return { ...manifest, activeSceneId: null };
    }
    return manifest;
  }

}
