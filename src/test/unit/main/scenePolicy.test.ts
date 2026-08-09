import { describe, expect, it } from 'vitest';
import {
  projectSceneManifest,
  sceneCapabilitiesFor,
} from '../../../main/scenePolicy';
import { createEmptySceneManifest } from '../../../shared/scenes';
import type { SceneManifest } from '../../../shared/sceneSchema';

const alice = '11111111-1111-4111-8111-111111111111';
const granted = '22222222-2222-4222-8222-222222222222';
const withheld = '33333333-3333-4333-8333-333333333333';

function manifest(activeSceneId: string | null = null): SceneManifest {
  const scene = (id: string) =>
    ({ id, name: `Scene ${id.slice(0, 4)}`, revision: 0 }) as unknown as
      SceneManifest['scenes'][number];
  return {
    ...createEmptySceneManifest(),
    access: [
      {
        capabilities: sceneCapabilitiesFor({ kind: 'gm' }, 'edit'),
        permissionRevision: 3,
        permissions: {
          allPlayers: 'none',
          overrides: [{ access: 'view', userId: alice }],
        },
        sceneId: granted,
      },
      {
        capabilities: sceneCapabilitiesFor({ kind: 'gm' }, 'edit'),
        permissionRevision: 0,
        permissions: { allPlayers: 'none', overrides: [] },
        sceneId: withheld,
      },
    ],
    activeSceneId,
    scenes: [scene(granted), scene(withheld)],
  };
}

describe('sceneCapabilitiesFor', () => {
  it('keeps presenting, ordering, and granting to the Game Master', () => {
    for (const access of ['none', 'view', 'edit'] as const) {
      const capabilities = sceneCapabilitiesFor({ kind: 'player' }, access);
      expect(capabilities.present).toBe(false);
      expect(capabilities.reorder).toBe(false);
      expect(capabilities.managePermissions).toBe(false);
    }
    expect(sceneCapabilitiesFor({ kind: 'gm' }, 'none')).toEqual({
      delete: true,
      managePermissions: true,
      present: true,
      reorder: true,
      update: true,
      view: true,
    });
  });

  it('opens the tab at view and the scene itself at edit', () => {
    expect(sceneCapabilitiesFor({ kind: 'player' }, 'none').view).toBe(false);
    const viewer = sceneCapabilitiesFor({ kind: 'player' }, 'view');
    expect(viewer.view).toBe(true);
    expect(viewer.update).toBe(false);
    expect(viewer.delete).toBe(false);
    const editor = sceneCapabilitiesFor({ kind: 'player' }, 'edit');
    expect(editor.update).toBe(true);
    expect(editor.delete).toBe(true);
  });
});

describe('projectSceneManifest', () => {
  it('hands the Game Master the campaign library untouched', () => {
    const full = manifest();
    expect(projectSceneManifest(full, { kind: 'gm' })).toBe(full);
  });

  it('gives a player only what they were granted, without a configuration', () => {
    const projected = projectSceneManifest(manifest(), {
      kind: 'player',
      userId: alice,
    });

    expect(projected.scenes.map(({ id }) => id)).toEqual([granted]);
    expect(projected.access).toEqual([
      {
        capabilities: sceneCapabilitiesFor({ kind: 'player' }, 'view'),
        permissionRevision: 0,
        permissions: null,
        sceneId: granted,
      },
    ]);
  });

  /* Presenting is how the table is shown a scene, so it answers to nobody's
     access. The scene still travels; it simply is not theirs to manage. */
  it('carries the presented scene even when it was never granted', () => {
    const projected = projectSceneManifest(manifest(withheld), {
      kind: 'player',
      userId: alice,
    });

    expect(projected.scenes.map(({ id }) => id)).toEqual([granted, withheld]);
    expect(
      projected.access.find(({ sceneId }) => sceneId === withheld)?.capabilities,
    ).toMatchObject({ update: false, view: false });
  });
});
