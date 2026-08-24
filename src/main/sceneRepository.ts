import { randomUUID } from 'node:crypto';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyObjectOrderLayers,
  createEmptySceneManifest,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  DEFAULT_TOKEN_ASSET_ID,
  isSceneToken,
  SCENE_OBJECT_LOCK_TIMEOUT_MS,
  sceneObjectStateOf,
  MAX_SCENE_EDIT_HISTORY,
  MAX_SCENE_FOG_POINTS,
  SCENE_LAYERS,
  DEFAULT_SCENE_DISTANCE,
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_NAME,
  DEFAULT_SCENE_PIXEL_SCALE,
  DEFAULT_SCENE_UNIT,
  DEFAULT_SCENE_WIDTH,
  normalizeSceneName,
  sceneBounds,
  type ScenePatch,
  type SceneArrangement,
  type SceneDrawing,
  type SceneLayer,
  type SceneEditActor,
  type SceneFog,
  type SceneFogMutation,
  type SceneErrorCode,
  type SceneManifest,
  type SceneObjectState,
  type SceneImage,
  type SceneRecord,
  type SceneResult,
  type SceneShape,
  type SceneText,
  type SceneToken,
  type SceneTokenHealthPresentation,
} from '../shared/scenes';
import type {
  SceneAccessLevel,
  UpdateScenePermissionsInput,
} from '../shared/sceneContracts';
import type { PermissionSubject } from '../shared/permissions';
import {
  sceneObjectStateSchema,
  sceneManifestSchema,
  sceneFogSchema,
  sceneRecordSchema,
} from '../shared/sceneSchema';
import { fail } from '../shared/result';
import {
  compactFogBrushPoints,
  compactFogOperations,
} from '../shared/sceneFogGeometry';
import { CampaignDatabase } from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';
import {
  TokenRepository,
  type TokenHealthHistoryChange,
  type TokenSnapshotHistoryChange,
  type TokenSnapshotChanges,
} from './tokenRepository';

const MAX_SCENES = 1024;
/**
 * Clears the range any real position can occupy, so surviving rows can be
 * shifted aside while a new order is written without tripping the unique index.
 * A campaign cannot hold enough scenes to reach it.
 */
const SCENE_POSITION_PARK_OFFSET = 1_000_000;
const MAX_DURABLE_SCENE_OPERATIONS = 2_048;

interface SceneRepositoryOptions {
  createId?: () => string;
  database: CampaignDatabase;
  now?: () => Date;
  mutations?: MutationQueue;
  tokens?: TokenRepository;
  touchCampaign?: () => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}

export interface SceneRepositoryMutation<T> {
  authoredDataChangedEntryIds: string[];
  result: SceneResult<T>;
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
      kind: 'shape';
      layer: SceneLayer;
      orderIndex: number;
      value: SceneShape;
    }
  | {
      index: number;
      kind: 'drawing';
      layer: SceneLayer;
      orderIndex: number;
      value: SceneDrawing;
    }
  | {
      index: number;
      kind: 'image';
      layer: SceneLayer;
      orderIndex: number;
      value: SceneImage;
    }
  | {
      index: number;
      kind: 'text';
      layer: SceneLayer;
      orderIndex: number;
      value: SceneText;
    }
  | {
      kind: 'map-image';
      value: NonNullable<SceneObjectState['mapImage']>;
    }
  | null;

interface SceneHistoryCommand {
  changes: Array<{
    expected: SceneObjectSnapshot;
    id: string;
    target: SceneObjectSnapshot;
  }>;
  fog?: {
    expected: SceneFog;
    target: SceneFog;
  };
  sceneId: string;
  tokenHealth?: TokenHealthHistoryChange[];
  tokenSnapshots?: TokenSnapshotHistoryChange[];
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

function objectOwner(actor: SceneEditActor): string | null {
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

function snapshotMap(state: SceneObjectState): Map<string, SceneObjectSnapshot> {
  const snapshots = new Map<string, SceneObjectSnapshot>();
  if (state.mapImage) {
    snapshots.set('canonical-map', {
      kind: 'map-image',
      value: structuredClone(state.mapImage),
    });
  }
  for (const layer of SCENE_LAYERS) {
    state.images[layer].forEach((image, index) => {
      snapshots.set(image.id, {
        index,
        kind: 'image',
        layer,
        orderIndex: state.objectOrder[layer].indexOf(image.id),
        value: structuredClone(image),
      });
    });
    state.drawings[layer].forEach((drawing, index) => {
      snapshots.set(drawing.id, {
        index,
        kind: 'drawing',
        layer,
        orderIndex: state.objectOrder[layer].indexOf(drawing.id),
        value: structuredClone(drawing),
      });
    });
    state.texts[layer].forEach((text, index) => {
      snapshots.set(text.id, {
        index,
        kind: 'text',
        layer,
        orderIndex: state.objectOrder[layer].indexOf(text.id),
        value: structuredClone(text),
      });
    });
    state.shapes[layer].forEach((shape, index) => {
      snapshots.set(shape.id, {
        index,
        kind: 'shape',
        layer,
        orderIndex: state.objectOrder[layer].indexOf(shape.id),
        value: structuredClone(shape),
      });
    });
  }
  return snapshots;
}

function snapshotChanges(
  before: SceneObjectState,
  after: SceneObjectState,
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

function removeObject(state: SceneObjectState, id: string): void {
  if (id === 'canonical-map') {
    state.mapImage = null;
  }
  for (const layer of SCENE_LAYERS) {
    state.objectOrder[layer] = state.objectOrder[layer].filter(
      (candidate) => candidate !== id,
    );
    state.images[layer] = state.images[layer].filter((image) => image.id !== id);
    state.drawings[layer] = state.drawings[layer].filter(
      (drawing) => drawing.id !== id,
    );
    state.texts[layer] = state.texts[layer].filter((text) => text.id !== id);
    state.shapes[layer] = state.shapes[layer].filter((shape) => shape.id !== id);
  }
}

function insertSnapshot(
  state: SceneObjectState,
  snapshot: SceneObjectSnapshot,
  nextObjectRevision: number,
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
    value.revision = nextObjectRevision;
    state.drawings[snapshot.layer].splice(
      Math.min(snapshot.index, state.drawings[snapshot.layer].length),
      0,
      value,
    );
  } else if (snapshot.kind === 'image') {
    const value = structuredClone(snapshot.value);
    state.images[snapshot.layer].splice(
      Math.min(snapshot.index, state.images[snapshot.layer].length),
      0,
      value,
    );
  } else if (snapshot.kind === 'text') {
    const value = structuredClone(snapshot.value);
    value.revision = nextObjectRevision;
    state.texts[snapshot.layer].splice(
      Math.min(snapshot.index, state.texts[snapshot.layer].length),
      0,
      value,
    );
  } else {
    const value = structuredClone(snapshot.value);
    value.revision = nextObjectRevision;
    state.shapes[snapshot.layer].splice(
      Math.min(snapshot.index, state.shapes[snapshot.layer].length),
      0,
      value,
    );
  }
  state.objectOrder[snapshot.layer].splice(
    Math.min(snapshot.orderIndex, state.objectOrder[snapshot.layer].length),
    0,
    snapshot.value.id,
  );
}

function objectIdsInLayer(
  state: SceneObjectState,
  layer: SceneLayer,
): string[] {
  return [
    ...state.images[layer],
    ...state.drawings[layer],
    ...state.shapes[layer],
    ...state.texts[layer],
  ].map((object) => object.id);
}

function objectLocation(
  state: SceneObjectState,
  id: string,
): { layer: SceneLayer; ownerId?: string | null; revision?: number } | null {
  for (const layer of SCENE_LAYERS) {
    for (const object of state.images[layer]) {
      if (object.id === id) return { layer };
    }
    for (const object of [
      ...state.drawings[layer],
      ...state.shapes[layer],
      ...state.texts[layer],
    ]) {
      if (object.id === id) {
        return { layer, ownerId: object.ownerId, revision: object.revision };
      }
    }
  }
  return null;
}

function reconcileObjectOrder(
  current: SceneObjectState,
  requested: SceneObjectState,
): void {
  for (const layer of SCENE_LAYERS) {
    const wanted = new Set(objectIdsInLayer(requested, layer));
    const order = current.objectOrder[layer].filter((id) => wanted.has(id));
    const retainedIds = new Set(order);
    const imageIds = new Set(requested.images[layer].map((image) => image.id));
    const shapeIds = new Set(requested.shapes[layer].map((shape) => shape.id));
    for (const id of objectIdsInLayer(requested, layer)) {
      if (retainedIds.has(id)) continue;
      if (shapeIds.has(id)) {
        const firstImageIndex = order.findIndex((candidate) =>
          imageIds.has(candidate));
        if (firstImageIndex >= 0) {
          order.splice(firstImageIndex, 0, id);
          continue;
        }
      }
      order.push(id);
    }
    requested.objectOrder[layer] = order;
  }
}

function reorderObjectIds(
  order: string[],
  selected: ReadonlySet<string>,
  direction: 'back' | 'backward' | 'forward' | 'front',
): string[] {
  if (direction === 'front') {
    return [
      ...order.filter((id) => !selected.has(id)),
      ...order.filter((id) => selected.has(id)),
    ];
  }
  if (direction === 'back') {
    return [
      ...order.filter((id) => selected.has(id)),
      ...order.filter((id) => !selected.has(id)),
    ];
  }
  const next = [...order];
  if (direction === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index]) && !selected.has(next[index + 1])) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index]) && !selected.has(next[index - 1])) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }
  return next;
}

function sameObjectIds(left: SceneObjectState, right: SceneObjectState): boolean {
  const ids = (state: SceneObjectState) =>
    SCENE_LAYERS.flatMap((layer) => objectIdsInLayer(state, layer)).sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

function objectContent(
  state: SceneObjectState,
  id: string,
): { kind: 'drawing' | 'image' | 'shape' | 'text'; value: unknown } | null {
  for (const layer of SCENE_LAYERS) {
    const image = state.images[layer].find((candidate) => candidate.id === id);
    if (image) return { kind: 'image', value: image };
    const drawing = state.drawings[layer].find((candidate) => candidate.id === id);
    if (drawing) return { kind: 'drawing', value: drawing };
    const shape = state.shapes[layer].find((candidate) => candidate.id === id);
    if (shape) return { kind: 'shape', value: shape };
    const text = state.texts[layer].find((candidate) => candidate.id === id);
    if (text) return { kind: 'text', value: text };
  }
  return null;
}

function sameArrangementObjectValues(
  current: SceneObjectState,
  requested: SceneObjectState,
): boolean {
  if (JSON.stringify(current.mapImage) !== JSON.stringify(requested.mapImage)) {
    return false;
  }
  return SCENE_LAYERS.flatMap((layer) => objectIdsInLayer(current, layer))
    .every((id) =>
      JSON.stringify(objectContent(current, id)) ===
        JSON.stringify(objectContent(requested, id)),
    );
}

function implicitLayerChange(
  current: SceneObjectState,
  requested: SceneObjectState,
): boolean {
  return SCENE_LAYERS.some((layer) =>
    objectIdsInLayer(current, layer).some((id) => {
      const next = objectLocation(requested, id);
      return next && next.layer !== layer;
    }),
  );
}

function arrangementProblem(
  current: SceneObjectState,
  requested: SceneObjectState,
  arrangement: SceneArrangement,
  actor: SceneEditActor,
  submitted: SceneObjectState,
  canEditToken: (source: SceneToken['source']) => boolean,
): { code: SceneErrorCode; message: string } | null {
  const targets = new Set(arrangement.targets);
  if (targets.size === 0 ||
    targets.size !== arrangement.targets.length ||
    !sameObjectIds(current, requested) ||
    !sameArrangementObjectValues(current, requested)) {
    return {
      code: 'invalid_input',
      message: 'The object arrangement contains unrelated scene changes.',
    };
  }
  const locations = arrangement.targets.map((id) => objectLocation(current, id));
  if (locations.some((location) => !location)) {
    return {
      code: 'invalid_input',
      message: 'One or more arranged objects no longer exist.',
    };
  }
  const sourceLayer = locations[0]!.layer;
  if (locations.some((location) => location!.layer !== sourceLayer)) {
    return {
      code: 'invalid_input',
      message: 'Objects can be arranged only within one source layer.',
    };
  }
  if (actor.kind === 'player') {
    if (
      arrangement.kind === 'move-layer' &&
      arrangement.targetLayer === 'gm'
    ) {
      return {
        code: 'permission_denied',
        message: 'Players cannot move objects to the Game Master layer.',
      };
    }
    const canArrange = arrangement.targets.every((id) => {
      const content = objectContent(current, id);
      if (content?.kind === 'image') {
        const image = content.value as SceneImage;
        return isSceneToken(image) &&
          canEditToken(image.source);
      }
      return arrangement.kind === 'reorder' &&
        objectLocation(current, id)?.ownerId === actor.userId;
    });
    if (
      sourceLayer === 'gm' ||
      !canArrange
    ) {
      return {
        code: 'permission_denied',
        message: 'Players can arrange only their own objects and linked tokens.',
      };
    }
    for (const id of arrangement.targets) {
      const currentObject = objectLocation(current, id);
      const candidate = objectLocation(submitted, id);
      if (currentObject?.revision !== candidate?.revision) {
        return {
          code: 'conflict',
          message: 'An arranged object changed somewhere else. Try again.',
        };
      }
    }
  }
  if (arrangement.kind === 'reorder') {
    if (implicitLayerChange(current, requested)) {
      return {
        code: 'invalid_input',
        message: 'Reordering cannot move objects between layers.',
      };
    }
    return null;
  }
  for (const layer of SCENE_LAYERS) {
    for (const id of objectIdsInLayer(current, layer)) {
      const next = objectLocation(requested, id);
      if (
        targets.has(id)
          ? next?.layer !== arrangement.targetLayer
          : next?.layer !== layer
      ) {
        return {
          code: 'invalid_input',
          message: 'The requested layer move contains unrelated changes.',
        };
      }
    }
  }
  return null;
}

function bumpArrangementTargetRevisions(
  current: SceneObjectState,
  requested: SceneObjectState,
  changedTargets: ReadonlySet<string>,
): void {
  for (const layer of SCENE_LAYERS) {
    for (const objects of [
      requested.drawings[layer],
      requested.shapes[layer],
      requested.texts[layer],
    ]) {
      for (const object of objects) {
        if (!changedTargets.has(object.id)) continue;
        const previous = objectLocation(current, object.id);
        if (previous?.revision !== undefined) {
          object.revision = Math.max(object.revision, previous.revision + 1);
        }
      }
    }
  }
}

function applyArrangement(
  current: SceneObjectState,
  requested: SceneObjectState,
  arrangement: SceneArrangement,
): void {
  const selected = new Set(arrangement.targets);
  const beforeLocations = new Map(
    arrangement.targets.map((id) => [id, objectLocation(current, id)]),
  );
  if (arrangement.kind === 'reorder') {
    const layer = beforeLocations.get(arrangement.targets[0])!.layer;
    requested.objectOrder[layer] = reorderObjectIds(
      requested.objectOrder[layer],
      selected,
      arrangement.direction,
    );
  } else {
    const moved = SCENE_LAYERS.flatMap((layer) => current.objectOrder[layer])
      .filter((id) => selected.has(id));
    for (const layer of SCENE_LAYERS) {
      requested.objectOrder[layer] = requested.objectOrder[layer].filter(
        (id) => !selected.has(id),
      );
    }
    requested.objectOrder[arrangement.targetLayer].push(...moved);
  }
  const changed = new Set(
    arrangement.targets.filter((id) => {
      const before = beforeLocations.get(id);
      const after = objectLocation(requested, id);
      return before?.layer !== after?.layer ||
        (before && after &&
          current.objectOrder[before.layer].indexOf(id) !==
            requested.objectOrder[after.layer].indexOf(id));
    }),
  );
  bumpArrangementTargetRevisions(current, requested, changed);
}

export class SceneRepository {
  private readonly database: CampaignDatabase;
  private readonly createId: () => string;
  private readonly mutations: MutationQueue;
  private readonly now: () => Date;
  private readonly objectLocks = new Map<string, SceneObjectLock>();
  private readonly redoStacks = new Map<string, SceneHistoryCommand[]>();
  private readonly touchCampaign?: () => Promise<void>;
  private readonly tokens: TokenRepository;
  private readonly undoStacks = new Map<string, SceneHistoryCommand[]>();
  private readonly warn: (message: string, error?: unknown) => void;

  private prepareToken(
    candidate: SceneToken,
    existing: SceneToken | undefined,
    actor: SceneEditActor,
    gridSize: number,
    sceneId: string,
  ): SceneResult<{ changes: TokenSnapshotChanges; token: SceneToken }> {
    const reference = this.tokens.prepareReference(
      actor,
      sceneId,
      candidate,
      existing,
    );
    if (!reference.ok) return reference;
    const { definition } = reference.value;
    const normalized = normalizeImageTransform(candidate);
    const requestsCanonicalSize =
      normalized.width === definition.size.width * gridSize &&
      normalized.height === definition.size.height * gridSize;
    const resized = !!existing &&
      (normalized.width !== existing.width || normalized.height !== existing.height);
    const preservesTemplateSize =
      reference.value.source.kind === 'template' &&
      (Boolean(existing) || reference.value.placement === 'duplicate-template');
    const size = preservesTemplateSize
      ? resized &&
          (candidate.size.kind !== 'default' ||
            candidate.size.width !== normalized.width / gridSize ||
            candidate.size.height !== normalized.height / gridSize)
        ? {
            height: normalized.height / gridSize,
            kind: 'override' as const,
            width: normalized.width / gridSize,
          }
        : candidate.size
      : requestsCanonicalSize
      ? { ...definition.size, kind: 'default' as const }
      : resized
      ? {
          height: normalized.height / gridSize,
          kind: 'override' as const,
          width: normalized.width / gridSize,
        }
      : existing?.size ?? candidate.size;
    const canonicalSize = size.kind === 'default' && !preservesTemplateSize
      ? { ...size, ...definition.size }
      : size;
    return {
      ok: true,
      value: {
        changes: reference.value.snapshotChanges,
        token: {
          ...normalized,
          assetId: definition.imageAssetId ?? DEFAULT_TOKEN_ASSET_ID,
          size: canonicalSize,
          ...(canonicalSize.kind === 'default' && !preservesTemplateSize
            ? {
                height: definition.size.height * gridSize,
                width: definition.size.width * gridSize,
              }
            : {}),
          source: reference.value.source,
        },
      },
    };
  }

  async hasLockedLinkedTokens(entryId: string): Promise<boolean> {
    this.expireLocks();
    const manifest = await this.readManifest();
    return manifest.scenes.some((scene) =>
      Object.values(scene.images).flat().some((image) =>
        isSceneToken(image) &&
        image.source.entryId === entryId &&
        this.objectLocks.has(`${scene.id}:${image.id}`),
      ),
    );
  }

  constructor({
    createId = randomUUID,
    database,
    now = () => new Date(),
    mutations = new MutationQueue(),
    tokens = new TokenRepository({ database }),
    touchCampaign,
    warn = console.warn,
  }: SceneRepositoryOptions) {
    this.database = database;
    this.createId = createId;
    this.now = now;
    this.mutations = mutations;
    this.touchCampaign = touchCampaign;
    this.tokens = tokens;
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
          `SELECT id, record_json, default_access, permission_revision
           FROM scenes
           ORDER BY position`,
        )
        .all() as unknown as Array<{
          default_access: SceneAccessLevel;
          id: string;
          permission_revision: number;
          record_json: string;
        }>;
      const overrides = this.permissionOverrides();
      const parsed = sceneManifestSchema.parse({
        access: records.map((row) => ({
          /* The stored configuration, projected for whoever asks later. The
             repository answers for the campaign; runtimes narrow it. */
          capabilities: {
            delete: true,
            managePermissions: true,
            present: true,
            reorder: true,
            update: true,
            view: true,
          },
          permissionRevision: row.permission_revision,
          permissions: {
            allPlayers: row.default_access,
            overrides: overrides.get(row.id) ?? [],
          },
          sceneId: row.id,
        })),
        activeSceneId: state.active_scene_id,
        revision: state.revision,
        scenes: records.map((row) => {
          const scene = sceneRecordSchema.parse(
            JSON.parse(row.record_json),
          );
          if (scene.id !== row.id) {
            throw new Error('Scene row ID does not match its record.');
          }
          return scene;
        }),
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

  private permissionOverrides(): Map<
    string,
    Array<{ access: SceneAccessLevel; userId: string }>
  > {
    const grouped = new Map<
      string,
      Array<{ access: SceneAccessLevel; userId: string }>
    >();
    for (const row of this.database.connection
      .prepare(
        `SELECT scene_id, user_id, access FROM scene_permissions
         ORDER BY scene_id, user_id`,
      )
      .all() as unknown as Array<{
        access: SceneAccessLevel;
        scene_id: string;
        user_id: string;
      }>) {
      const entries = grouped.get(row.scene_id) ?? [];
      entries.push({ access: row.access, userId: row.user_id });
      grouped.set(row.scene_id, entries);
    }
    return grouped;
  }

  listUsers(): PermissionSubject[] {
    return (
      this.database.connection
        .prepare('SELECT id, username FROM campaign_users ORDER BY username')
        .all() as unknown as Array<{ id: string; username: string }>
    ).map(({ id, username }) => ({ id, username }));
  }

  updateScenePermissions(
    input: Omit<UpdateScenePermissionsInput, 'campaignId'>,
  ): Promise<SceneResult<SceneManifest>> {
    return this.mutate(async (manifest) => {
      const entry = manifest.access.find(
        ({ sceneId }) => sceneId === input.sceneId,
      );
      if (!entry) {
        return failure('not_found', 'The scene no longer exists.', input.sceneId);
      }
      if (entry.permissionRevision !== input.expectedPermissionRevision) {
        return failure(
          'conflict',
          'The scene permissions changed before this change could be saved.',
          input.sceneId,
        );
      }
      const users = new Set(this.listUsers().map(({ id }) => id));
      const seen = new Set<string>();
      const valid = input.permissions.overrides.every(({ userId }) => {
        if (!users.has(userId) || seen.has(userId)) return false;
        seen.add(userId);
        return true;
      });
      if (!valid) {
        return failure('invalid_input', 'The scene permissions are invalid.', input.sceneId);
      }
      const database = this.database.connection;
      database.exec('BEGIN IMMEDIATE');
      try {
        database
          .prepare(
            `UPDATE scenes
             SET default_access = ?, permission_revision = permission_revision + 1
             WHERE id = ?`,
          )
          .run(input.permissions.allPlayers, input.sceneId);
        database
          .prepare('DELETE FROM scene_permissions WHERE scene_id = ?')
          .run(input.sceneId);
        const insert = database.prepare(
          `INSERT INTO scene_permissions (scene_id, user_id, access)
           VALUES (?, ?, ?)`,
        );
        for (const override of input.permissions.overrides) {
          insert.run(input.sceneId, override.userId, override.access);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        this.warn('Failed to replace scene permissions.', error);
        return failure(
          'storage_error',
          'The scene permissions could not be saved.',
          input.sceneId,
        );
      }
      await this.touchAfterChange();
      /* Access is not the scene, so no scene revision moves and the manifest
         is simply re-read with the new configuration in place. */
      return { ok: true, value: await this.readManifest() };
    });
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
        fog: createDefaultFog(),
        grid: createDefaultGrid(),
        height: DEFAULT_SCENE_HEIGHT,
        id: this.createId(),
        drawings: createEmptyDrawingLayers(),
        images: createEmptyImageLayers(),
        mapImage: null,
        name: DEFAULT_SCENE_NAME,
        objectOrder: createEmptyObjectOrderLayers(),
        pixelScale: DEFAULT_SCENE_PIXEL_SCALE,
        revision: 0,
        shapes: createEmptyShapeLayers(),
        unit: DEFAULT_SCENE_UNIT,
        updatedAt: timestamp,
        width: DEFAULT_SCENE_WIDTH,
        texts: createEmptyTextLayers(),
      };
      return {
        manifest: { ...manifest, scenes: [...manifest.scenes, scene] },
        result: { ok: true, value: scene },
      };
    });
  }

  setImages(
    sceneId: string,
    state: SceneObjectState,
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
    state: SceneObjectState,
    expectedRevision: number,
    operationId: string,
    actor: SceneEditActor,
    arrangement?: SceneArrangement,
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
          [
            ...Object.values(state.images).flat().filter(isSceneToken),
            ...Object.values(state.drawings).flat(),
            ...Object.values(state.texts).flat(),
            ...Object.values(state.shapes).flat(),
          ].map((object) => object.id),
        );
        const deletesExistingToken = Object.values(current.images)
          .flat()
          .some((image) =>
            isSceneToken(image) &&
            this.tokens.canManipulate(actor, image.source) &&
            !requestedIds.has(image.id),
          );
        const deletesExistingOwnedObject = [
          ...current.drawings.token,
          ...current.texts.token,
          ...current.shapes.token,
        ]
          .some(
            (object) =>
              object.ownerId === actor.userId &&
              !requestedIds.has(object.id),
          );
        if (deletesExistingToken || deletesExistingOwnedObject) {
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
      const normalizedState = prepared.value.state;
      const before = sceneObjectStateOf(current);
      reconcileObjectOrder(before, normalizedState);
      if (arrangement) {
        const problem = arrangementProblem(
          before,
          normalizedState,
          arrangement,
          actor,
          state,
          (source) => this.tokens.canManipulate(actor, source),
        );
        if (problem) {
          return failure(problem.code, problem.message, sceneId);
        }
        applyArrangement(before, normalizedState, arrangement);
      } else if (implicitLayerChange(before, normalizedState)) {
        return failure(
          'invalid_input',
          'Moving objects between layers requires an explicit arrangement.',
          sceneId,
        );
      }
      const parsed = sceneObjectStateSchema.safeParse(normalizedState);
      if (!parsed.success) {
        return failure(
          'invalid_input',
          'The scene object state is invalid or outside the supported safety bounds.',
          sceneId,
        );
      }
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
        tokenSnapshots: this.tokens.captureHistory(
          prepared.value.tokenChanges,
        ),
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
        tokenChanges: prepared.value.tokenChanges,
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
      const stateTargets = snapshotMap(sceneObjectStateOf(scene));
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
            !snapshot ||
            (snapshot.kind === 'image'
              ? !isSceneToken(snapshot.value) ||
                !this.tokens.canManipulate(actor, snapshot.value.source)
              : snapshot.kind === 'drawing' ||
                  snapshot.kind === 'shape' ||
                  snapshot.kind === 'text'
                ? snapshot.value.ownerId !== actor.userId
                : true)
          );
        })
      ) {
        return failure(
          'permission_denied',
          'Players can transform only their own objects and linked tokens.',
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
      const expiresAt = Date.now() + SCENE_OBJECT_LOCK_TIMEOUT_MS;
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
    const expiresAt = Date.now() + SCENE_OBJECT_LOCK_TIMEOUT_MS;
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
    return this.undoWithEffects(sceneId, actor).then(({ result }) => result);
  }

  undoWithEffects(
    sceneId: string,
    actor: SceneEditActor,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
    return this.applyHistory(sceneId, actor, false);
  }

  redo(
    sceneId: string,
    actor: SceneEditActor,
  ): Promise<SceneResult<SceneRecord>> {
    return this.redoWithEffects(sceneId, actor).then(({ result }) => result);
  }

  redoWithEffects(
    sceneId: string,
    actor: SceneEditActor,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
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
      const grid = { ...current.grid, ...stripUndefined(patch.grid) };
      const next: SceneRecord = {
        ...current,
        distance: patch.distance ?? current.distance,
        grid,
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
        images: Object.fromEntries(
          SCENE_LAYERS.map((layer) => [
            layer,
            current.images[layer].map((image) =>
              isSceneToken(image)
                ? {
                    ...image,
                    height: image.size.height * grid.size,
                    width: image.size.width * grid.size,
                  }
                : image,
            ),
          ]),
        ) as SceneRecord['images'],
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

  /**
   * Rewrites the whole scene list in the requested order.
   *
   * Manifest array order is already the stored order — readManifest reads
   * `ORDER BY position` and writeManifest writes the array index back — so this
   * only has to permute the array. No scene record changes, so no scene
   * revision moves; the manifest revision guards the write.
   */
  reorderScenes(
    orderedSceneIds: readonly string[],
    expectedRevision: number,
  ): Promise<SceneResult<SceneManifest>> {
    return this.mutate(async (manifest) => {
      if (manifest.revision !== expectedRevision) {
        return failure(
          'conflict',
          'The scene order changed somewhere else. Reopen it and try again.',
        );
      }
      const requested = [...orderedSceneIds];
      const current = manifest.scenes.map((scene) => scene.id);
      if (
        requested.length !== current.length ||
        new Set(requested).size !== requested.length ||
        !requested.every((id) => current.includes(id))
      ) {
        return failure(
          'invalid_input',
          'The requested scene order is invalid.',
        );
      }
      const byId = new Map(manifest.scenes.map((scene) => [scene.id, scene]));
      const next = {
        ...manifest,
        scenes: requested.map((id) => byId.get(id)!),
      };
      /* The returned manifest carries the pre-bump revision, matching present()
         and update(); callers refresh from the change event that follows. */
      return { manifest: next, result: { ok: true, value: next } };
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
                    gm: scene.images.gm.flatMap((image) =>
                      image.assetId !== assetId
                        ? [image]
                        : isSceneToken(image)
                          ? [{ ...image, assetId: DEFAULT_TOKEN_ASSET_ID }]
                          : [],
                    ),
                    map: scene.images.map.flatMap((image) =>
                      image.assetId !== assetId
                        ? [image]
                        : isSceneToken(image)
                          ? [{ ...image, assetId: DEFAULT_TOKEN_ASSET_ID }]
                          : [],
                    ),
                    token: scene.images.token.flatMap((image) =>
                      image.assetId !== assetId
                        ? [image]
                        : isSceneToken(image)
                          ? [{ ...image, assetId: DEFAULT_TOKEN_ASSET_ID }]
                          : [],
                    ),
                  },
                  mapImage:
                    scene.mapImage?.assetId === assetId ? null : scene.mapImage,
                  objectOrder: {
                    gm: scene.objectOrder.gm.filter((id) =>
                      !scene.images.gm.some((image) =>
                        image.id === id && image.assetId === assetId &&
                        !isSceneToken(image))),
                    map: scene.objectOrder.map.filter((id) =>
                      !scene.images.map.some((image) =>
                        image.id === id && image.assetId === assetId &&
                        !isSceneToken(image))),
                    token: scene.objectOrder.token.filter((id) =>
                      !scene.images.token.some((image) =>
                        image.id === id && image.assetId === assetId &&
                        !isSceneToken(image))),
                  },
                  revision: scene.revision + 1,
                  updatedAt: timestamp,
                }
              : scene,
          ),
        },
        result: { ok: true, value: null },
        tokenChanges: this.tokens.detachAssetChanges(assetId, timestamp),
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
    requested: SceneObjectState,
    actor: SceneEditActor,
  ): SceneResult<{
    state: SceneObjectState;
    tokenChanges: TokenSnapshotChanges;
  }> {
    const currentState = sceneObjectStateOf(current);
    const currentDrawings = new Map(
      Object.values(current.drawings)
        .flat()
        .map((drawing) => [drawing.id, drawing]),
    );
    const currentTexts = new Map(
      Object.values(current.texts)
        .flat()
        .map((text) => [text.id, text]),
    );
    const currentShapes = new Map(
      Object.values(current.shapes)
        .flat()
        .map((shape) => [shape.id, shape]),
    );
    const preparedSnapshotChanges: TokenSnapshotChanges[] = [];
    for (const candidate of Object.values(requested.shapes).flat()) {
      const existing = currentShapes.get(candidate.id);
      if (existing && existing.kind !== candidate.kind) {
        return failure(
          'invalid_input',
          'An existing shape cannot be changed into another shape kind.',
          current.id,
        );
      }
    }
    if (actor.kind === 'gm') {
      const drawings = createEmptyDrawingLayers();
      const images = createEmptyImageLayers();
      const texts = createEmptyTextLayers();
      const shapes = createEmptyShapeLayers();
      for (const layer of SCENE_LAYERS) {
        drawings[layer] = requested.drawings[layer].map((candidate) => {
          const existing = currentDrawings.get(candidate.id);
          const normalized = normalizeDrawing({
            ...candidate,
            ownerId: existing?.ownerId ?? objectOwner(actor),
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
        texts[layer] = requested.texts[layer].map((candidate) => {
          const existing = currentTexts.get(candidate.id);
          const normalized = normalizeText({
            ...candidate,
            ownerId: existing?.ownerId ?? objectOwner(actor),
            ...(existing ? { style: existing.style } : {}),
          });
          return {
            ...normalized,
            revision: existing
              ? sameText(existing, normalized)
                ? existing.revision
                : existing.revision + 1
              : 0,
          };
        });
        shapes[layer] = requested.shapes[layer].map((candidate) => {
          const existing = currentShapes.get(candidate.id);
          const normalized = normalizeShape({
            ...candidate,
            ownerId: existing?.ownerId ?? objectOwner(actor),
            ...(existing ? { style: existing.style } : {}),
          });
          return {
            ...normalized,
            revision: existing
              ? sameShape(existing, normalized)
                ? existing.revision
                : existing.revision + 1
              : 0,
          };
        });
        for (const candidate of requested.images[layer]) {
          const currentImage = Object.values(current.images)
            .flat()
            .find((image) => image.id === candidate.id);
          if (currentImage && isSceneToken(currentImage) !== isSceneToken(candidate)) {
            return failure(
              'invalid_input',
              'An existing image cannot be converted into or out of a linked token.',
              current.id,
            );
          }
          if (!isSceneToken(candidate)) {
            images[layer].push(normalizeImageTransform(candidate));
            continue;
          }
          const prepared = this.prepareToken(
            candidate,
            currentImage && isSceneToken(currentImage) ? currentImage : undefined,
            actor,
            current.grid.size,
            current.id,
          );
          if (!prepared.ok) {
            return failure(
              prepared.error.code,
              prepared.error.message,
              current.id,
            );
          }
          preparedSnapshotChanges.push(prepared.value.changes);
          images[layer].push(prepared.value.token);
        }
      }
      return {
        ok: true,
        value: {
          state: {
            drawings,
            images,
            mapImage: requested.mapImage
              ? normalizeImageTransform(requested.mapImage)
              : null,
            objectOrder: structuredClone(requested.objectOrder),
            shapes,
            texts,
          },
          tokenChanges: this.tokens.changesForState(
            Object.values(current.images).flat().filter(isSceneToken),
            Object.values(images).flat().filter(isSceneToken),
            preparedSnapshotChanges,
          ),
        },
      };
    }

    const requestedDrawings = new Map<
      string,
      { drawing: SceneDrawing; layer: SceneLayer }
    >();
    const requestedTexts = new Map<
      string,
      { layer: SceneLayer; text: SceneText }
    >();
    const requestedShapes = new Map<
      string,
      { layer: SceneLayer; shape: SceneShape }
    >();
    const requestedTokens = new Map<
      string,
      { layer: SceneLayer; token: SceneToken }
    >();
    for (const layer of SCENE_LAYERS) {
      for (const drawing of requested.drawings[layer]) {
        requestedDrawings.set(drawing.id, { drawing, layer });
      }
      for (const text of requested.texts[layer]) {
        requestedTexts.set(text.id, { layer, text });
      }
      for (const shape of requested.shapes[layer]) {
        requestedShapes.set(shape.id, { layer, shape });
      }
      for (const image of requested.images[layer]) {
        if (isSceneToken(image)) {
          requestedTokens.set(image.id, { layer, token: image });
        }
      }
    }
    const merged = structuredClone(currentState);
    const preparedDrawings = new Map<string, SceneDrawing>();
    const preparedTexts = new Map<string, SceneText>();
    const preparedShapes = new Map<string, SceneShape>();
    const currentImages = new Map(
      Object.values(current.images).flat().map((image) => [image.id, image]),
    );
    const preparedTokens = new Map<
      string,
      { layer: SceneLayer; token: SceneToken }
    >();
    for (const [id, candidate] of requestedTokens) {
      if (candidate.layer === 'gm') {
        return failure(
          'permission_denied',
          'Players cannot manipulate objects on the Game Master layer.',
          current.id,
        );
      }
      const currentImage = currentImages.get(id);
      if (currentImage && !isSceneToken(currentImage)) {
        return failure(
          'invalid_input',
          'An existing image cannot be converted into a linked token.',
          current.id,
        );
      }
      if (
        currentImage &&
        isSceneToken(currentImage) &&
        !this.tokens.canManipulate(actor, currentImage.source)
      ) {
        const currentLayer = SCENE_LAYERS.find((layer) =>
          current.images[layer].some((image) => image.id === id),
        );
        if (
          currentLayer === candidate.layer &&
          JSON.stringify(currentImage) === JSON.stringify(candidate.token)
        ) {
          continue;
        }
        return failure(
          'permission_denied',
          'You cannot manipulate a token linked to this Journal entry.',
          current.id,
        );
      }
      const prepared = this.prepareToken(
        candidate.token,
        currentImage && isSceneToken(currentImage) ? currentImage : undefined,
        actor,
        current.grid.size,
        current.id,
      );
      if (!prepared.ok) {
        return failure(prepared.error.code, prepared.error.message, current.id);
      }
      preparedSnapshotChanges.push(prepared.value.changes);
      preparedTokens.set(id, {
        layer: candidate.layer,
        token: prepared.value.token,
      });
    }
    for (const [id, candidate] of requestedDrawings) {
      const existing = currentDrawings.get(id);
      if (existing && existing.ownerId !== actor.userId) {
        continue;
      }
      if (candidate.layer !== 'token') {
        const currentLocation = objectLocation(currentState, id);
        if (
          existing &&
          currentLocation?.layer === candidate.layer &&
          sameDrawing(existing, candidate.drawing)
        ) {
          continue;
        }
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
      preparedDrawings.set(id, {
        ...normalized,
        revision: existing
          ? sameDrawing(existing, normalized)
            ? existing.revision
            : existing.revision + 1
          : 0,
      });
    }
    for (const [id, candidate] of requestedTexts) {
      const existing = currentTexts.get(id);
      if (existing && existing.ownerId !== actor.userId) {
        continue;
      }
      if (candidate.layer !== 'token') {
        const currentLocation = objectLocation(currentState, id);
        if (
          existing &&
          currentLocation?.layer === candidate.layer &&
          sameText(existing, candidate.text)
        ) {
          continue;
        }
        return failure(
          'permission_denied',
          'Players can place text only on the public token layer.',
          current.id,
        );
      }
      if (
        existing &&
        candidate.text.revision !== existing.revision &&
        !sameText(existing, candidate.text)
      ) {
        return failure(
          'conflict',
          'The text changed somewhere else. Try again.',
          current.id,
        );
      }
      const normalized = normalizeText({
        ...candidate.text,
        ownerId: actor.userId,
        ...(existing ? { style: existing.style } : {}),
      });
      preparedTexts.set(id, {
        ...normalized,
        revision: existing
          ? sameText(existing, normalized)
            ? existing.revision
            : existing.revision + 1
          : 0,
      });
    }
    for (const [id, candidate] of requestedShapes) {
      const existing = currentShapes.get(id);
      if (existing && existing.ownerId !== actor.userId) {
        continue;
      }
      if (candidate.layer !== 'token') {
        const currentLocation = objectLocation(currentState, id);
        if (
          existing &&
          currentLocation?.layer === candidate.layer &&
          sameShape(existing, candidate.shape)
        ) {
          continue;
        }
        return failure(
          'permission_denied',
          'Players can place shapes only on the public token layer.',
          current.id,
        );
      }
      if (
        existing &&
        candidate.shape.revision !== existing.revision &&
        !sameShape(existing, candidate.shape)
      ) {
        return failure(
          'conflict',
          'The shape changed somewhere else. Try again.',
          current.id,
        );
      }
      const normalized = normalizeShape({
        ...candidate.shape,
        ownerId: actor.userId,
        ...(existing ? { style: existing.style } : {}),
      });
      preparedShapes.set(id, {
        ...normalized,
        revision: existing
          ? sameShape(existing, normalized)
            ? existing.revision
            : existing.revision + 1
          : 0,
      });
    }
    const currentTokenDrawingIds = new Set(
      current.drawings.token.map((drawing) => drawing.id),
    );
    merged.drawings.token = [
      ...current.drawings.token.flatMap((drawing) => {
        if (drawing.ownerId !== actor.userId) {
          return [drawing];
        }
        const replacement = preparedDrawings.get(drawing.id);
        return replacement ? [replacement] : [];
      }),
      ...[...preparedDrawings].flatMap(([id, drawing]) =>
        currentTokenDrawingIds.has(id) ? [] : [drawing],
      ),
    ];
    const currentTokenTextIds = new Set(
      current.texts.token.map((text) => text.id),
    );
    merged.texts.token = [
      ...current.texts.token.flatMap((text) => {
        if (text.ownerId !== actor.userId) {
          return [text];
        }
        const replacement = preparedTexts.get(text.id);
        return replacement ? [replacement] : [];
      }),
      ...[...preparedTexts].flatMap(([id, text]) =>
        currentTokenTextIds.has(id) ? [] : [text],
      ),
    ];
    const currentTokenShapeIds = new Set(
      current.shapes.token.map((shape) => shape.id),
    );
    merged.shapes.token = [
      ...current.shapes.token.flatMap((shape) => {
        if (shape.ownerId !== actor.userId) {
          return [shape];
        }
        const replacement = preparedShapes.get(shape.id);
        return replacement ? [replacement] : [];
      }),
      ...[...preparedShapes].flatMap(([id, shape]) =>
        currentTokenShapeIds.has(id) ? [] : [shape],
      ),
    ];
    merged.images = createEmptyImageLayers();
    merged.images.gm = current.images.gm.map((image) => structuredClone(image));
    for (const layer of ['map', 'token'] as const) {
      merged.images[layer] = current.images[layer].flatMap((image) => {
        if (!isSceneToken(image)) return [structuredClone(image)];
        if (!this.tokens.canManipulate(actor, image.source)) {
          return [structuredClone(image)];
        }
        return [];
      });
    }
    for (const { layer, token } of preparedTokens.values()) {
      merged.images[layer].push(token);
    }
    return {
      ok: true,
      value: {
        state: merged,
        tokenChanges: this.tokens.changesForState(
          Object.values(current.images).flat().filter(isSceneToken),
          Object.values(merged.images).flat().filter(isSceneToken),
          preparedSnapshotChanges,
        ),
      },
    };
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
    this.undoStacks.set(key, undo.slice(-MAX_SCENE_EDIT_HISTORY));
    this.redoStacks.set(key, []);
  }

  private applyHistory(
    sceneId: string,
    actor: SceneEditActor,
    redo: boolean,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
    return this.mutateWithEffects(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      const key = this.historyKey(actor, sceneId);
      const source = redo ? this.redoStacks : this.undoStacks;
      const destination = redo ? this.undoStacks : this.redoStacks;
      const stack = source.get(key) ?? [];
      const currentState = sceneObjectStateOf(current);
      const currentSnapshots = snapshotMap(currentState);
      let command: SceneHistoryCommand | undefined;
      while ((command = stack.pop())) {
        if (
          command.changes.every(({ expected, id }) =>
            sameSnapshot(currentSnapshots.get(id) ?? null, expected),
          ) &&
          (!command.fog ||
            JSON.stringify(command.fog.expected) ===
              JSON.stringify(current.fog)) &&
          (!command.tokenSnapshots ||
            this.tokens.historyMatches(command.tokenSnapshots)) &&
          (!command.tokenHealth ||
            this.tokens.healthHistoryMatches(command.tokenHealth))
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
          const leftIndex = 'orderIndex' in left.target
            ? left.target.orderIndex
            : -1;
          const rightIndex = 'orderIndex' in right.target
            ? right.target.orderIndex
            : -1;
          return leftIndex - rightIndex;
        });
      for (const change of insertions) {
        const previous = command.changes.find(
          (candidate) => candidate.id === change.id,
        )?.expected;
        const currentRevision =
          previous?.kind === 'drawing' || previous?.kind === 'shape' || previous?.kind === 'text'
            ? previous.value.revision
            : -1;
        const targetRevision =
          change.target.kind === 'drawing' || change.target.kind === 'shape' || change.target.kind === 'text'
            ? change.target.value.revision
            : -1;
        insertSnapshot(
          nextState,
          change.target,
          Math.max(currentRevision, targetRevision) + 1,
        );
      }
      const parsed = sceneObjectStateSchema.safeParse(nextState);
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
        ...(command.fog
          ? { fog: structuredClone(command.fog.target) }
          : {}),
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
        ...(command.fog
          ? {
              fog: {
                expected: structuredClone(command.fog.target),
                target: structuredClone(command.fog.expected),
              },
            }
          : {}),
        sceneId,
        ...(command.tokenHealth
          ? {
              tokenHealth: command.tokenHealth.map(
                ({ expected, source, target }) => ({
                  expected: structuredClone(target),
                  source: structuredClone(source),
                  target: structuredClone(expected),
                }),
              ),
            }
          : {}),
        ...(command.tokenSnapshots
          ? {
              tokenSnapshots: command.tokenSnapshots.map(
                ({ expected, id, target }) => ({
                  expected: target ? structuredClone(target) : null,
                  id,
                  target: expected ? structuredClone(expected) : null,
                }),
              ),
            }
          : {}),
      };
      const destinationStack = destination.get(key) ?? [];
      destinationStack.push(inverse);
      destination.set(
        key,
        destinationStack.slice(-MAX_SCENE_EDIT_HISTORY),
      );
      return {
        manifest: {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        },
        result: { ok: true, value: next },
        ...(command.tokenHealth
          ? { healthChanges: structuredClone(command.tokenHealth) }
          : {}),
        ...(command.tokenSnapshots
          ? { tokenChanges: this.tokens.applyHistory(command.tokenSnapshots) }
          : {}),
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

  setFog(
    sceneId: string,
    mutation: SceneFogMutation,
    expectedRevision: number,
    operationId: string,
  ): Promise<SceneResult<SceneRecord>> {
    return this.mutate(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      const completedOperation: CompletedSceneOperation = {
        actorKey: 'gm',
        operationId,
        sceneId,
      };
      try {
        if (this.hasCompletedOperation(completedOperation)) {
          return { ok: true, value: current };
        }
      } catch (error) {
        this.warn('Failed to read durable fog operation state.', error);
        return failure('storage_error', 'The fog could not be saved.', sceneId);
      }
      if (current.revision !== expectedRevision) {
        return failure(
          'conflict',
          'The scene changed somewhere else. Reopen it and try again.',
          sceneId,
        );
      }
      const fog = structuredClone(current.fog);
      if (mutation.kind === 'append') {
        if (mutation.operation.id !== operationId) {
          return failure(
            'invalid_input',
            'The fog operation identity is invalid.',
            sceneId,
          );
        }
        const operation = structuredClone(mutation.operation);
        if (operation.kind === 'brush') {
          operation.points = compactFogBrushPoints(
            operation.points,
            operation.width,
          );
        }
        const outside = operation.kind === 'box'
          ? operation.x + operation.width > current.width ||
            operation.y + operation.height > current.height
          : operation.points.some(
              (point) =>
                point.x < 0 ||
                point.x > current.width ||
                point.y < 0 ||
                point.y > current.height,
            );
        if (outside) {
          return failure(
            'invalid_input',
            'The fog operation is outside the scene.',
            sceneId,
          );
        }
        fog.operations.push(operation);
        const pointCount = fog.operations.reduce(
          (total, entry) =>
            total + (entry.kind === 'brush' ? entry.points.length : 0),
          0,
        );
        if (pointCount > MAX_SCENE_FOG_POINTS) {
          fog.operations = compactFogOperations(fog.operations);
        }
      } else if (mutation.kind === 'clear-all') {
        fog.base = 'clear';
        fog.operations = [];
      } else if (mutation.kind === 'cover-all') {
        fog.base = 'covered';
        fog.operations = [];
      } else {
        fog.color = mutation.color.toLowerCase();
      }
      const parsed = sceneFogSchema.safeParse(fog);
      if (!parsed.success) {
        return failure(
          'invalid_input',
          'The fog state is invalid or outside the supported safety bounds.',
          sceneId,
        );
      }
      if (JSON.stringify(parsed.data) === JSON.stringify(current.fog)) {
        try {
          this.rememberOperation(completedOperation);
        } catch (error) {
          this.warn('Failed to store durable fog operation state.', error);
          return failure('storage_error', 'The fog could not be saved.', sceneId);
        }
        return { ok: true, value: current };
      }
      const next: SceneRecord = {
        ...current,
        fog: parsed.data,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
      };
      this.recordHistory({ kind: 'gm' }, {
        changes: [],
        fog: {
          expected: structuredClone(next.fog),
          target: structuredClone(current.fog),
        },
        sceneId,
      });
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
  private async mutate<T>(
    operation: (
      manifest: SceneManifest,
    ) => Promise<
      | SceneResult<T>
      | {
          completedOperation?: CompletedSceneOperation;
          healthChanges?: TokenHealthHistoryChange[];
          manifest: SceneManifest;
          result: SceneResult<T>;
          tokenChanges?: TokenSnapshotChanges;
        }
    >,
  ): Promise<SceneResult<T>> {
    return (await this.mutateWithEffects(operation)).result;
  }

  private mutateWithEffects<T>(
    operation: (
      manifest: SceneManifest,
    ) => Promise<
      | SceneResult<T>
      | {
          completedOperation?: CompletedSceneOperation;
          healthChanges?: TokenHealthHistoryChange[];
          manifest: SceneManifest;
          result: SceneResult<T>;
          tokenChanges?: TokenSnapshotChanges;
        }
    >,
  ): Promise<SceneRepositoryMutation<T>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const outcome = await operation(manifest);
      if (!('manifest' in outcome)) {
        return { authoredDataChangedEntryIds: [], result: outcome };
      }
      try {
        await this.writeManifest(
          {
            ...outcome.manifest,
            revision: manifest.revision + 1,
          },
          outcome.completedOperation,
          outcome.tokenChanges,
          outcome.healthChanges,
        );
      } catch (error) {
        this.warn('Failed to write the scene manifest.', error);
        return {
          authoredDataChangedEntryIds: [],
          result: failure('storage_error', 'The scene could not be saved.'),
        };
      }
      await this.touchAfterChange();
      return {
        authoredDataChangedEntryIds: [
          ...new Set(
            (outcome.healthChanges ?? []).flatMap(({ source }) =>
              source.kind === 'linked' ? [source.entryId] : [],
            ),
          ),
        ],
        result: outcome.result,
      };
    });
  }

  listTokenHealth(
    sceneId: string,
    actor: SceneEditActor,
  ): SceneResult<SceneTokenHealthPresentation[]> {
    return this.tokens.listHealth(actor, sceneId);
  }

  adjustTokenHealth(
    sceneId: string,
    tokenId: string,
    command: string,
    operationId: string,
    actor: SceneEditActor,
  ): Promise<SceneResult<SceneRecord>> {
    return this.adjustTokenHealthWithEffects(
      sceneId,
      tokenId,
      command,
      operationId,
      actor,
    ).then(({ result }) => result);
  }

  adjustTokenHealthWithEffects(
    sceneId: string,
    tokenId: string,
    command: string,
    operationId: string,
    actor: SceneEditActor,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
    return this.mutateWithEffects(async (manifest) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return failure('not_found', 'The scene no longer exists.', sceneId);
      }
      const completedOperation: CompletedSceneOperation = {
        actorKey: actorKey(actor),
        operationId,
        sceneId,
      };
      try {
        if (this.hasCompletedOperation(completedOperation)) {
          return { ok: true, value: current };
        }
      } catch (error) {
        this.warn('Failed to read durable health operation state.', error);
        return failure('storage_error', 'The health could not be saved.', sceneId);
      }
      const prepared = this.tokens.prepareHealthAdjustment(
        actor,
        current,
        tokenId,
        command,
      );
      if (!prepared.ok) return prepared;
      if (JSON.stringify(prepared.value.expected) === JSON.stringify(
        prepared.value.target,
      )) {
        try {
          this.rememberOperation(completedOperation);
        } catch (error) {
          this.warn('Failed to store durable health operation state.', error);
          return failure('storage_error', 'The health could not be saved.', sceneId);
        }
        return { ok: true, value: current };
      }
      const timestamp = this.now().toISOString();
      const next: SceneRecord = {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
      };
      this.recordHistory(actor, {
        changes: [],
        sceneId,
        tokenHealth: [{
          expected: structuredClone(prepared.value.target),
          source: structuredClone(prepared.value.source),
          target: structuredClone(prepared.value.expected),
        }],
      });
      return {
        completedOperation,
        healthChanges: [prepared.value],
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

  private async touchAfterChange(): Promise<void> {
    if (!this.touchCampaign) return;
    try {
      await this.touchCampaign();
    } catch (error) {
      /* The scene change is already durable. A metadata timestamp failure must
         not make a successful write look as though it should be retried. */
      this.warn('Failed to touch the campaign after a scene change.', error);
    }
  }

  private async writeManifest(
    manifest: SceneManifest,
    completedOperation?: CompletedSceneOperation,
    tokenChanges?: TokenSnapshotChanges,
    healthChanges?: TokenHealthHistoryChange[],
  ): Promise<void> {
    const parsed = sceneManifestSchema.parse(manifest);
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      /* Rewriting every row would drop each scene's access with it, because
         the permission overrides cascade off this table. Only scenes that
         actually left the manifest are deleted; the rest keep the access the
         Game Master gave them while their order and record move. */
      const retained = new Set(parsed.scenes.map((scene) => scene.id));
      const remove = database.prepare('DELETE FROM scenes WHERE id = ?');
      for (const row of database
        .prepare('SELECT id FROM scenes')
        .all() as unknown as Array<{ id: string }>) {
        if (!retained.has(row.id)) remove.run(row.id);
      }
      /* Positions are unique and non-negative, so surviving rows are shifted
         above every position the new order can use before it lands. */
      database.exec(
        `UPDATE scenes SET position = position + ${SCENE_POSITION_PARK_OFFSET}`,
      );
      const insert = database.prepare(
        `INSERT INTO scenes (
           id, position, record_json, default_access, permission_revision
         ) VALUES (?, ?, ?, 'none', 0)
         ON CONFLICT(id) DO UPDATE
           SET position = excluded.position, record_json = excluded.record_json`,
      );
      parsed.scenes.forEach((scene, position) => {
        insert.run(scene.id, position, JSON.stringify(scene));
      });
      if (tokenChanges) this.tokens.commitChanges(tokenChanges);
      if (healthChanges) {
        this.tokens.commitHealthChanges(healthChanges, this.now().toISOString());
      }
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

function normalizeText(text: SceneText): SceneText {
  const rotation = round(((text.rotation % 360) + 360) % 360);
  return {
    ...structuredClone(text),
    content: text.content.replaceAll('\r\n', '\n'),
    rotation: rotation >= 360 ? 0 : rotation,
    scaleX: Math.max(0.001, round(text.scaleX)),
    scaleY: Math.max(0.001, round(text.scaleY)),
    style: {
      ...text.style,
      fontSize: round(text.style.fontSize),
      primaryColor: text.style.primaryColor.toLowerCase(),
      strokeColor: text.style.strokeColor.toLowerCase(),
      strokeWidth: round(text.style.strokeWidth),
    },
    x: round(text.x),
    y: round(text.y),
  };
}

function withoutTextRevision(text: SceneText): Omit<SceneText, 'revision'> {
  return Object.fromEntries(
    Object.entries(text).filter(([key]) => key !== 'revision'),
  ) as Omit<SceneText, 'revision'>;
}

function sameText(left: SceneText, right: SceneText): boolean {
  return JSON.stringify(withoutTextRevision(left)) ===
    JSON.stringify(withoutTextRevision(right));
}

function normalizeShape(shape: SceneShape): SceneShape {
  const normalized = normalizeImageTransform(shape);
  return {
    ...structuredClone(normalized),
    ...(normalized.kind === 'cone' ? { spread: round(normalized.spread) } : {}),
    style: {
      ...normalized.style,
      backgroundOpacity: round(normalized.style.backgroundOpacity),
      fontSize: round(normalized.style.fontSize),
      fontStrokeWidth: round(normalized.style.fontStrokeWidth),
      strokeOpacity: round(normalized.style.strokeOpacity),
      strokeWidth: round(normalized.style.strokeWidth),
    },
  } as SceneShape;
}

function withoutShapeRevision(shape: SceneShape): Omit<SceneShape, 'revision'> {
  return Object.fromEntries(
    Object.entries(shape).filter(([key]) => key !== 'revision'),
  ) as Omit<SceneShape, 'revision'>;
}

function sameShape(left: SceneShape, right: SceneShape): boolean {
  return JSON.stringify(withoutShapeRevision(left)) ===
    JSON.stringify(withoutShapeRevision(right));
}
