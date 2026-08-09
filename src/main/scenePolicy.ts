import { permissionAccessFor } from '../shared/permissions';
import type { SceneAccessLevel } from '../shared/sceneContracts';
import type { SceneCapabilities, SceneManifest } from '../shared/sceneSchema';

export type SceneAccessActor =
  | { kind: 'gm' }
  | { kind: 'player'; userId: string };

export interface SceneActor {
  kind: 'gm' | 'player';
}

/**
 * What a player may do with one scene in the Scenes tab.
 *
 * This governs the tab and nothing else. A presented scene reaches every player
 * and behaves exactly as it always has, whatever their access says: presenting
 * is how the table is shown a scene, and access is how the Game Master decides
 * who may go and manage one.
 */
export function sceneCapabilitiesFor(
  actor: SceneActor,
  access: SceneAccessLevel,
): SceneCapabilities {
  if (actor.kind === 'gm') {
    return {
      delete: true,
      managePermissions: true,
      present: true,
      reorder: true,
      update: true,
      view: true,
    };
  }
  const editable = access === 'edit';
  return {
    delete: editable,
    /* Granting access, ordering the shared list, and choosing what the table
       is looking at stay the Game Master's however much of a scene a player
       was given. */
    managePermissions: false,
    present: false,
    reorder: false,
    update: editable,
    view: editable || access === 'view',
  };
}

/**
 * Narrows the campaign's manifest to one actor.
 *
 * The presented scene is always carried, whatever its access, because that is
 * what the player is looking at. Access decides the Scenes tab instead: a
 * presented scene nobody was granted still draws, and simply reports no view
 * capability, so it never appears as a row to manage.
 */
export function projectSceneManifest(
  manifest: SceneManifest,
  actor: SceneAccessActor,
): SceneManifest {
  if (actor.kind === 'gm') return manifest;
  const access = new Map<string, SceneAccessLevel>(
    manifest.access.map((entry) => [
      entry.sceneId,
      entry.permissions
        ? permissionAccessFor(entry.permissions, actor.userId)
        : 'none',
    ]),
  );
  const carried = manifest.scenes.filter(
    (scene) =>
      access.get(scene.id) !== 'none' || scene.id === manifest.activeSceneId,
  );
  return {
    ...manifest,
    access: carried.map((scene) => ({
      capabilities: sceneCapabilitiesFor(actor, access.get(scene.id) ?? 'none'),
      /* A player never edits access, so the counter guarding those writes is
         not theirs to hold. */
      permissionRevision: 0,
      permissions: null,
      sceneId: scene.id,
    })),
    scenes: carried,
  };
}
