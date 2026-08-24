import { randomUUID } from 'node:crypto';
import { DiceRoll } from '@dice-roller/rpg-dice-roller';
import type { JsonValue } from '../shared/gameSystems';
import type { JournalAccessLevel } from '../shared/journal';
import {
  DEFAULT_TOKEN_ASSET_ID,
  isSceneToken,
  SCENE_LAYERS,
  type SceneEditActor,
  type SceneRecord,
  type SceneResult,
  type SceneToken,
  type SceneTokenHealthPresentation,
} from '../shared/scenes';
import { sceneRecordSchema } from '../shared/sceneSchema';
import { getJournalEntryTypeDefinition } from '../systems/catalog';
import type {
  JournalEntryDefaultToken,
  JournalEntryTokenHealthValue,
} from '../systems/types';
import type { CampaignDatabase } from './storage/campaignDatabase';

interface TokenRepositoryOptions {
  createId?: () => string;
  database: CampaignDatabase;
  now?: () => Date;
  roll?: (notation: string) => number;
}

interface RootEntry {
  data: JsonValue;
  id: string;
  name: string;
  token: JournalEntryDefaultToken;
  typeId: string;
}

export interface TemplateTokenSnapshot {
  createdAt: string;
  data: JsonValue;
  id: string;
  name: string;
  revision: number;
  rootEntryId: string;
  sceneId: string;
  typeId: string;
  updatedAt: string;
}

export interface TokenRootSnapshot {
  data: JsonValue;
  entryId: string;
  name: string;
  token: JournalEntryDefaultToken;
  typeId: string;
}

interface TemplateSnapshotRow {
  created_at: string;
  data_json: string;
  id: string;
  name: string;
  revision: number;
  root_entry_id: string;
  scene_id: string;
  type_id: string;
  updated_at: string;
}

export interface TokenSnapshotChanges {
  deleteIds: string[];
  upserts: TemplateTokenSnapshot[];
}

export interface TokenSnapshotHistoryChange {
  expected: TemplateTokenSnapshot | null;
  id: string;
  target: TemplateTokenSnapshot | null;
}

export interface TokenHealthHistoryChange {
  expected: JournalEntryTokenHealthValue;
  source: SceneToken['source'];
  target: JournalEntryTokenHealthValue;
}

export interface PreparedTokenReference {
  definition: JournalEntryDefaultToken;
  placement: 'duplicate-template' | 'existing' | 'new';
  snapshotChanges: TokenSnapshotChanges;
  source: SceneToken['source'];
}

function failure<T>(
  code: 'invalid_input' | 'permission_denied' | 'storage_error',
  message: string,
): SceneResult<T> {
  return { error: { code, message }, ok: false };
}

function emptyChanges(): TokenSnapshotChanges {
  return { deleteIds: [], upserts: [] };
}

/**
 * Owns the lifecycle boundary between a Journal record reference and a scene
 * token. SceneRepository owns spatial state; this module owns whether the
 * represented record is live or a private, durable Template snapshot.
 */
export class TokenRepository {
  private readonly createId: () => string;
  private readonly database: CampaignDatabase;
  private readonly now: () => Date;
  private readonly roll: (notation: string) => number;

  constructor({
    createId = randomUUID,
    database,
    now = () => new Date(),
    roll = (notation) => new DiceRoll(notation).total,
  }: TokenRepositoryOptions) {
    this.createId = createId;
    this.database = database;
    this.now = now;
    this.roll = roll;
  }

  canManipulate(actor: SceneEditActor, source: SceneToken['source']): boolean {
    if (source.kind === 'linked') {
      return Boolean(this.readRoot(actor, source.entryId, 'edit'));
    }
    const snapshot = this.readSnapshot(source.instanceId);
    if (!snapshot || snapshot.rootEntryId !== source.entryId) return false;
    if (actor.kind === 'gm') return true;
    return Boolean(this.readRoot(actor, snapshot.rootEntryId, 'edit'));
  }

  prepareRootDataForSave(typeId: string, data: JsonValue): JsonValue | null {
    const definition = getJournalEntryTypeDefinition(
      this.database.readSystem(),
      typeId,
    );
    if (!definition) return null;
    if (definition.prepareDataForSave) {
      return definition.prepareDataForSave(data, this.roll);
    }
    return definition.validateData(data) ? structuredClone(data) : null;
  }

  listHealth(
    actor: SceneEditActor,
    sceneId: string,
  ): SceneResult<SceneTokenHealthPresentation[]> {
    const scene = this.sceneRows().find(({ id }) => id === sceneId)?.scene;
    if (!scene) return failure('invalid_input', 'The scene does not exist.');
    const presentations: SceneTokenHealthPresentation[] = [];
    for (const token of Object.values(scene.images).flat().filter(isSceneToken)) {
      const resolved = this.resolveHealthSource(token.source);
      if (!resolved) continue;
      const health = resolved.definition.token?.health?.read(resolved.data);
      if (!health) continue;
      const canView = actor.kind === 'gm' || this.hasRootAccess(
        actor,
        resolved.rootEntryId,
        'view',
      );
      const ratio = health.maximumHundredths > 0
        ? Math.max(0, Math.min(1,
            health.currentHundredths / health.maximumHundredths,
          ))
        : 0;
      presentations.push({
        ...(canView
          ? {
              currentHundredths: health.currentHundredths,
              maximumHundredths: health.maximumHundredths,
            }
          : {}),
        down: health.maximumHundredths > 0 && health.currentHundredths <= 0,
        editable: this.canManipulate(actor, token.source),
        ratio,
        tokenId: token.id,
      });
    }
    return { ok: true, value: presentations };
  }

  prepareHealthAdjustment(
    actor: SceneEditActor,
    scene: SceneRecord,
    tokenId: string,
    command: string,
  ): SceneResult<TokenHealthHistoryChange> {
    const token = Object.values(scene.images).flat()
      .find((image): image is SceneToken =>
        isSceneToken(image) && image.id === tokenId,
      );
    if (!token) return failure('invalid_input', 'The token does not exist.');
    if (!this.canManipulate(actor, token.source)) {
      return failure('permission_denied', 'You cannot edit this token health.');
    }
    const resolved = this.resolveHealthSource(token.source);
    const healthDefinition = resolved?.definition.token?.health;
    if (!resolved || !healthDefinition) {
      return failure('invalid_input', 'This token does not support health.');
    }
    const expected = healthDefinition.read(resolved.data);
    const nextData = healthDefinition.applyCommand(resolved.data, command);
    const target = nextData ? healthDefinition.read(nextData) : null;
    if (
      !expected ||
      !target ||
      !resolved.definition.validateData(nextData)
    ) {
      return failure('invalid_input', 'The health adjustment is invalid.');
    }
    return {
      ok: true,
      value: {
        expected: structuredClone(expected),
        source: structuredClone(token.source),
        target: structuredClone(target),
      },
    };
  }

  healthHistoryMatches(changes: TokenHealthHistoryChange[]): boolean {
    return changes.every(({ expected, source }) => {
      const resolved = this.resolveHealthSource(source);
      const health = resolved?.definition.token?.health?.read(resolved.data);
      return JSON.stringify(health) === JSON.stringify(expected);
    });
  }

  commitHealthChanges(
    changes: TokenHealthHistoryChange[],
    timestamp: string,
  ): void {
    for (const change of changes) {
      const resolved = this.resolveHealthSource(change.source);
      const healthDefinition = resolved?.definition.token?.health;
      const current = resolved && healthDefinition
        ? healthDefinition.read(resolved.data)
        : null;
      if (
        !resolved ||
        !healthDefinition ||
        JSON.stringify(current) !== JSON.stringify(change.expected)
      ) {
        throw new Error('Token health changed before it could be saved.');
      }
      const data = healthDefinition.write(resolved.data, change.target);
      if (!data || !resolved.definition.validateData(data)) {
        throw new Error('The system rejected the token health state.');
      }
      if (change.source.kind === 'linked') {
        this.database.connection.prepare(
          `UPDATE journal_entries
           SET data_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        ).run(JSON.stringify(data), timestamp, change.source.entryId);
      } else {
        this.database.connection.prepare(
          `UPDATE scene_token_snapshots
           SET data_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        ).run(JSON.stringify(data), timestamp, change.source.instanceId);
      }
    }
  }

  getTemplateSnapshot(
    actor: SceneEditActor,
    instanceId: string,
  ): TemplateTokenSnapshot | null {
    const snapshot = this.readSnapshot(instanceId);
    if (!snapshot) return null;
    if (
      actor.kind === 'player' &&
      !this.readRoot(actor, snapshot.rootEntryId, 'view')
    ) {
      return null;
    }
    return structuredClone(snapshot);
  }

  prepareReference(
    actor: SceneEditActor,
    sceneId: string,
    candidate: SceneToken,
    existing?: SceneToken,
  ): SceneResult<PreparedTokenReference> {
    if (existing && existing.source.entryId !== candidate.source.entryId) {
      return failure(
        'invalid_input',
        'A token cannot be changed to reference another Journal entry.',
      );
    }
    if (existing) {
      if (JSON.stringify(existing.source) !== JSON.stringify(candidate.source)) {
        return failure(
          'invalid_input',
          'A token reference can be changed only from Character settings.',
        );
      }
      if (!this.canManipulate(actor, existing.source)) {
        return failure(
          'permission_denied',
          'You cannot manipulate a token representing this Journal entry.',
        );
      }
      if (existing.source.kind === 'linked') {
        const root = this.readRoot(actor, existing.source.entryId, 'edit');
        if (!root) {
          return failure(
            'permission_denied',
            'You cannot manipulate a token linked to this Journal entry.',
          );
        }
        return {
          ok: true,
          value: {
            definition: root.token,
            placement: 'existing',
            snapshotChanges: emptyChanges(),
            source: existing.source,
          },
        };
      }
      const snapshot = this.readSnapshot(existing.source.instanceId);
      if (!snapshot) {
        return failure('storage_error', 'The Template token snapshot is missing.');
      }
      const definition = this.snapshotDefaultToken(snapshot);
      if (!definition) {
        return failure('storage_error', 'The Template token snapshot is invalid.');
      }
      return {
        ok: true,
        value: {
          definition,
          placement: 'existing',
          snapshotChanges: emptyChanges(),
          source: existing.source,
        },
      };
    }

    let snapshotSource: Pick<
      TemplateTokenSnapshot,
      'data' | 'name' | 'rootEntryId' | 'typeId'
    >;
    let placement: PreparedTokenReference['placement'] = 'new';
    if (candidate.source.kind === 'template') {
      const duplicated = this.readSnapshot(candidate.source.instanceId);
      if (
        !duplicated ||
        duplicated.rootEntryId !== candidate.source.entryId
      ) {
        return failure('invalid_input', 'The Template token source is invalid.');
      }
      const liveRoot = this.readRoot(actor, duplicated.rootEntryId, 'edit');
      if (actor.kind === 'player' && !liveRoot) {
        return failure(
          'permission_denied',
          'You cannot duplicate a Template token representing this Journal entry.',
        );
      }
      if (liveRoot && liveRoot.token.type !== 'template') {
        return failure('invalid_input', 'The Template token source is stale.');
      }
      snapshotSource = duplicated;
      placement = 'duplicate-template';
    } else {
      const root = this.readRoot(actor, candidate.source.entryId, 'edit');
      if (!root) {
        return failure(
          'permission_denied',
          'You cannot place a token representing this Journal entry.',
        );
      }
      if (root.token.type === 'linked') {
        return {
          ok: true,
          value: {
            definition: root.token,
            placement: 'new',
            snapshotChanges: emptyChanges(),
            source: { entryId: root.id, kind: 'linked' },
          },
        };
      }
      const definition = getJournalEntryTypeDefinition(
        this.database.readSystem(),
        root.typeId,
      );
      const data = definition?.token?.health
        ? definition.token.health.materialize(root.data, this.roll)
        : root.data;
      if (!data) {
        return failure(
          'invalid_input',
          'The Character health formula could not be rolled.',
        );
      }
      snapshotSource = {
        data,
        name: root.name,
        rootEntryId: root.id,
        typeId: root.typeId,
      };
    }
    const timestamp = this.now().toISOString();
    const snapshot: TemplateTokenSnapshot = {
      createdAt: timestamp,
      data: structuredClone(snapshotSource.data),
      id: this.createId(),
      name: snapshotSource.name,
      revision: 0,
      rootEntryId: snapshotSource.rootEntryId,
      sceneId,
      typeId: snapshotSource.typeId,
      updatedAt: timestamp,
    };
    const definition = this.snapshotDefaultToken(snapshot);
    if (!definition) {
      return failure('storage_error', 'The Character cannot be copied into a Template token.');
    }
    return {
      ok: true,
      value: {
        definition,
        placement,
        snapshotChanges: { deleteIds: [], upserts: [snapshot] },
        source: {
          entryId: snapshotSource.rootEntryId,
          instanceId: snapshot.id,
          kind: 'template',
        },
      },
    };
  }

  changesForState(
    previous: SceneToken[],
    next: SceneToken[],
    prepared: TokenSnapshotChanges[],
  ): TokenSnapshotChanges {
    const retained = new Set(
      next.flatMap((token) =>
        token.source.kind === 'template' ? [token.source.instanceId] : [],
      ),
    );
    return {
      deleteIds: previous.flatMap((token) =>
        token.source.kind === 'template' && !retained.has(token.source.instanceId)
          ? [token.source.instanceId]
          : [],
      ),
      upserts: prepared.flatMap(({ upserts }) => upserts),
    };
  }

  commitChanges(changes: TokenSnapshotChanges): void {
    const remove = this.database.connection.prepare(
      'DELETE FROM scene_token_snapshots WHERE id = ?',
    );
    for (const id of new Set(changes.deleteIds)) remove.run(id);
    const upsert = this.database.connection.prepare(
      `INSERT INTO scene_token_snapshots (
         id, scene_id, root_entry_id, type_id, name, data_json,
         revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scene_id = excluded.scene_id,
         root_entry_id = excluded.root_entry_id,
         type_id = excluded.type_id,
         name = excluded.name,
         data_json = excluded.data_json,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    );
    for (const snapshot of changes.upserts) {
      upsert.run(
        snapshot.id,
        snapshot.sceneId,
        snapshot.rootEntryId,
        snapshot.typeId,
        snapshot.name,
        JSON.stringify(snapshot.data),
        snapshot.revision,
        snapshot.createdAt,
        snapshot.updatedAt,
      );
    }
  }

  captureHistory(
    changes: TokenSnapshotChanges,
  ): TokenSnapshotHistoryChange[] {
    const next = new Map(changes.upserts.map((snapshot) => [snapshot.id, snapshot]));
    const ids = new Set([...changes.deleteIds, ...next.keys()]);
    return [...ids].map((id) => ({
      expected: next.get(id) ? structuredClone(next.get(id)!) : null,
      id,
      target: this.readSnapshot(id),
    }));
  }

  historyMatches(changes: TokenSnapshotHistoryChange[]): boolean {
    return changes.every(({ expected, id }) =>
      JSON.stringify(this.readSnapshot(id)) === JSON.stringify(expected),
    );
  }

  applyHistory(changes: TokenSnapshotHistoryChange[]): TokenSnapshotChanges {
    return {
      deleteIds: changes.flatMap(({ id, target }) => target ? [] : [id]),
      upserts: changes.flatMap(({ target }) => target ? [structuredClone(target)] : []),
    };
  }

  synchronizeLinkedTokens(
    entryId: string,
    previous: JournalEntryDefaultToken,
    next: JournalEntryDefaultToken,
    timestamp: string,
  ): number {
    const artChanged = previous.imageAssetId !== next.imageAssetId;
    const sizeChanged = previous.size.height !== next.size.height ||
      previous.size.width !== next.size.width;
    if (!artChanged && !sizeChanged) return 0;
    let changedTokens = 0;
    const changedScenes = this.rewriteScenes(timestamp, ({ scene, images }) => {
      let changed = false;
      for (const layer of SCENE_LAYERS) {
        images[layer] = images[layer].map((image) => {
          if (
            !isSceneToken(image) ||
            image.source.kind !== 'linked' ||
            image.source.entryId !== entryId
          ) {
            return image;
          }
          changed = true;
          changedTokens += 1;
          return {
            ...image,
            ...(artChanged
              ? { assetId: next.imageAssetId ?? DEFAULT_TOKEN_ASSET_ID }
              : {}),
            ...(sizeChanged
              ? {
                  height: next.size.height * scene.grid.size,
                  size: { ...next.size, kind: 'default' as const },
                  width: next.size.width * scene.grid.size,
                }
              : {}),
          };
        });
      }
      return changed;
    });
    if (changedScenes > 0) this.bumpSceneManifest();
    return changedTokens;
  }

  convertDescendants(
    root: TokenRootSnapshot,
    previousData: JsonValue,
    timestamp: string,
  ): number {
    const snapshotChanges: TokenSnapshotChanges = emptyChanges();
    let linkedSnapshotData = root.data;
    if (root.token.type === 'template') {
      const definition = getJournalEntryTypeDefinition(
        this.database.readSystem(),
        root.typeId,
      );
      const healthDefinition = definition?.token?.health;
      const previousHealth = healthDefinition?.read(previousData);
      if (healthDefinition && !healthDefinition.read(root.data) && previousHealth) {
        const preserved = healthDefinition.write(root.data, previousHealth);
        if (preserved && definition.validateData(preserved)) {
          linkedSnapshotData = preserved;
        }
      }
    }
    let converted = 0;
    const changedScenes = this.rewriteScenes(timestamp, ({ id, scene, images }) => {
      let changed = false;
      for (const layer of SCENE_LAYERS) {
        images[layer] = images[layer].map((image) => {
          if (!isSceneToken(image) || image.source.entryId !== root.entryId) {
            return image;
          }
          if (root.token.type === 'template' && image.source.kind === 'linked') {
            const snapshotId = this.createId();
            snapshotChanges.upserts.push({
              createdAt: timestamp,
              data: structuredClone(linkedSnapshotData),
              id: snapshotId,
              name: root.name,
              revision: 0,
              rootEntryId: root.entryId,
              sceneId: id,
              typeId: root.typeId,
              updatedAt: timestamp,
            });
            changed = true;
            converted += 1;
            return {
              ...image,
              assetId: root.token.imageAssetId ?? DEFAULT_TOKEN_ASSET_ID,
              source: {
                entryId: root.entryId,
                instanceId: snapshotId,
                kind: 'template' as const,
              },
            };
          }
          if (root.token.type === 'linked' && image.source.kind === 'template') {
            snapshotChanges.deleteIds.push(image.source.instanceId);
            changed = true;
            converted += 1;
            return {
              ...image,
              assetId: root.token.imageAssetId ?? DEFAULT_TOKEN_ASSET_ID,
              size: {
                height: image.height / scene.grid.size,
                kind: 'override' as const,
                width: image.width / scene.grid.size,
              },
              source: { entryId: root.entryId, kind: 'linked' as const },
            };
          }
          return image;
        });
      }
      return changed;
    });
    this.commitChanges(snapshotChanges);
    if (changedScenes > 0) this.bumpSceneManifest();
    return converted;
  }

  countDescendants(entryId: string): { linked: number; template: number } {
    const counts = { linked: 0, template: 0 };
    for (const { scene } of this.sceneRows()) {
      for (const image of Object.values(scene.images).flat()) {
        if (!isSceneToken(image) || image.source.entryId !== entryId) continue;
        counts[image.source.kind] += 1;
      }
    }
    return counts;
  }

  removeDescendants(
    entryId: string,
    deleteTemplates: boolean,
    timestamp: string,
  ): { linked: number; template: number } {
    const removed = { linked: 0, template: 0 };
    const snapshotIds: string[] = [];
    const update = this.database.connection.prepare(
      'UPDATE scenes SET record_json = ? WHERE id = ?',
    );
    let changedScenes = 0;
    for (const { id, scene } of this.sceneRows()) {
      const removedObjectIds = new Set<string>();
      const images = structuredClone(scene.images);
      for (const layer of SCENE_LAYERS) {
        images[layer] = images[layer].filter((image) => {
          if (!isSceneToken(image) || image.source.entryId !== entryId) {
            return true;
          }
          const deleting = image.source.kind === 'linked' || deleteTemplates;
          if (!deleting) return true;
          removed[image.source.kind] += 1;
          removedObjectIds.add(image.id);
          if (image.source.kind === 'template') {
            snapshotIds.push(image.source.instanceId);
          }
          return false;
        });
      }
      if (removedObjectIds.size === 0) continue;
      const changed = sceneRecordSchema.parse({
        ...scene,
        images,
        objectOrder: Object.fromEntries(
          SCENE_LAYERS.map((layer) => [
            layer,
            scene.objectOrder[layer].filter((objectId) =>
              !removedObjectIds.has(objectId),
            ),
          ]),
        ),
        revision: scene.revision + 1,
        updatedAt: timestamp,
      });
      update.run(JSON.stringify(changed), id);
      changedScenes += 1;
    }
    this.commitChanges({ deleteIds: snapshotIds, upserts: [] });
    if (changedScenes > 0) this.bumpSceneManifest();
    return removed;
  }

  detachAssetChanges(
    assetId: string,
    timestamp: string,
  ): TokenSnapshotChanges {
    const rows = this.database.connection.prepare(
      `SELECT id FROM scene_token_snapshots ORDER BY id`,
    ).all() as unknown as Array<{ id: string }>;
    const upserts: TemplateTokenSnapshot[] = [];
    for (const { id } of rows) {
      const snapshot = this.readSnapshot(id);
      if (!snapshot) continue;
      const definition = getJournalEntryTypeDefinition(
        this.database.readSystem(),
        snapshot.typeId,
      );
      if (!definition?.token) continue;
      const token = definition.token.readDefaultToken(snapshot.data);
      if (token.imageAssetId !== assetId) continue;
      const data = definition.token.writeDefaultToken(snapshot.data, {
        ...token,
        imageAssetId: null,
      });
      if (!definition.validateData(data)) continue;
      upserts.push({
        ...snapshot,
        data,
        revision: snapshot.revision + 1,
        updatedAt: timestamp,
      });
    }
    return { deleteIds: [], upserts };
  }

  private readRoot(
    actor: SceneEditActor,
    entryId: string,
    required: 'edit' | 'view',
  ): RootEntry | null {
    if (
      actor.kind === 'player' &&
      !this.hasRootAccess(actor, entryId, required)
    ) {
      return null;
    }
    return this.readRootUnchecked(entryId);
  }

  private hasRootAccess(
    actor: Extract<SceneEditActor, { kind: 'player' }>,
    entryId: string,
    required: 'edit' | 'view',
  ): boolean {
    const row = this.database.connection.prepare(
      `SELECT default_access
       FROM journal_entries
       WHERE id = ?`,
    ).get(entryId) as {
      default_access: JournalAccessLevel;
    } | undefined;
    if (!row) return false;
    const override = this.database.connection.prepare(
      `SELECT access FROM journal_entry_permissions
       WHERE entry_id = ? AND user_id = ?`,
    ).get(entryId, actor.userId) as { access: JournalAccessLevel } | undefined;
    const access = override?.access ?? row.default_access;
    return required === 'edit' ? access === 'edit' : access !== 'none';
  }

  private readRootUnchecked(entryId: string): RootEntry | null {
    const row = this.database.connection.prepare(
      `SELECT id, type_id, name, data_json
       FROM journal_entries
       WHERE id = ?`,
    ).get(entryId) as {
      data_json: string;
      id: string;
      name: string;
      type_id: string;
    } | undefined;
    if (!row) return null;
    const definition = getJournalEntryTypeDefinition(
      this.database.readSystem(),
      row.type_id,
    );
    if (!definition?.token) return null;
    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      return null;
    }
    if (!definition.validateData(data as JsonValue)) return null;
    return {
      data: structuredClone(data as JsonValue),
      id: row.id,
      name: row.name,
      token: definition.token.readDefaultToken(data as JsonValue),
      typeId: row.type_id,
    };
  }

  private resolveHealthSource(source: SceneToken['source']): {
    data: JsonValue;
    definition: NonNullable<ReturnType<typeof getJournalEntryTypeDefinition>>;
    rootEntryId: string;
  } | null {
    const record = source.kind === 'linked'
      ? this.readRootUnchecked(source.entryId)
      : this.readSnapshot(source.instanceId);
    if (!record) return null;
    const definition = getJournalEntryTypeDefinition(
      this.database.readSystem(),
      record.typeId,
    );
    if (!definition?.token?.health || !definition.validateData(record.data)) {
      return null;
    }
    return {
      data: structuredClone(record.data),
      definition,
      rootEntryId: source.entryId,
    };
  }

  private readSnapshot(id: string): TemplateTokenSnapshot | null {
    const row = this.database.connection.prepare(
      `SELECT id, scene_id, root_entry_id, type_id, name, data_json,
              revision, created_at, updated_at
       FROM scene_token_snapshots
       WHERE id = ?`,
    ).get(id) as TemplateSnapshotRow | undefined;
    if (!row) return null;
    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      return null;
    }
    const definition = getJournalEntryTypeDefinition(
      this.database.readSystem(),
      row.type_id,
    );
    if (!definition?.token || !definition.validateData(data as JsonValue)) {
      return null;
    }
    return {
      createdAt: row.created_at,
      data: structuredClone(data as JsonValue),
      id: row.id,
      name: row.name,
      revision: row.revision,
      rootEntryId: row.root_entry_id,
      sceneId: row.scene_id,
      typeId: row.type_id,
      updatedAt: row.updated_at,
    };
  }

  private snapshotDefaultToken(
    snapshot: TemplateTokenSnapshot,
  ): JournalEntryDefaultToken | null {
    const definition = getJournalEntryTypeDefinition(
      this.database.readSystem(),
      snapshot.typeId,
    );
    if (!definition?.token || !definition.validateData(snapshot.data)) return null;
    return definition.token.readDefaultToken(snapshot.data);
  }

  private sceneRows(): Array<{ id: string; scene: SceneRecord }> {
    return (this.database.connection.prepare(
      'SELECT id, record_json FROM scenes ORDER BY position',
    ).all() as unknown as Array<{ id: string; record_json: string }>).map(
      ({ id, record_json }) => ({
        id,
        scene: sceneRecordSchema.parse(JSON.parse(record_json)),
      }),
    );
  }

  private rewriteScenes(
    timestamp: string,
    rewrite: (value: {
      id: string;
      images: SceneRecord['images'];
      scene: SceneRecord;
    }) => boolean,
  ): number {
    const update = this.database.connection.prepare(
      'UPDATE scenes SET record_json = ? WHERE id = ?',
    );
    let changedScenes = 0;
    for (const { id, scene } of this.sceneRows()) {
      const images = structuredClone(scene.images);
      if (!rewrite({ id, images, scene })) continue;
      const changed = sceneRecordSchema.parse({
        ...scene,
        images,
        revision: scene.revision + 1,
        updatedAt: timestamp,
      });
      update.run(JSON.stringify(changed), id);
      changedScenes += 1;
    }
    return changedScenes;
  }

  private bumpSceneManifest(): void {
    this.database.connection.exec(
      'UPDATE scene_manifest SET revision = revision + 1 WHERE singleton = 1',
    );
  }
}
