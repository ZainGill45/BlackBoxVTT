import type { PermissionsModalSubject } from '../../../components/ui/PermissionsModal';
import type { PermissionSubject } from '../../../shared/permissions';
import type { SceneAccessLevel } from '../../../shared/sceneContracts';
import type { SceneAccessEntry } from '../../../shared/sceneSchema';
import type { SceneApi } from '../../../shared/scenes';

const ACCESS_LABELS: Record<SceneAccessLevel, string> = {
  edit: 'Edit',
  none: 'No access',
  view: 'View',
};

const LEVELS: readonly SceneAccessLevel[] = ['none', 'view', 'edit'];

export function scenePermissionSubject({
  access,
  campaignId,
  sceneApi,
  sceneName,
  users,
}: {
  access: SceneAccessEntry;
  campaignId: string;
  sceneApi: SceneApi;
  sceneName: string;
  users: readonly PermissionSubject[];
}): PermissionsModalSubject<SceneAccessLevel> {
  return {
    async commit(permissions, revision) {
      const result = await sceneApi.updatePermissions({
        campaignId,
        expectedPermissionRevision: revision,
        permissions,
        sceneId: access.sceneId,
      });
      /* Saving broadcasts a scene change, and the panel re-reads itself from
         that, so nothing here has to push the new state back. */
      if (result.ok) return { kind: 'ok' };
      if (result.error.code !== 'conflict') {
        return { kind: 'failed', message: result.error.message };
      }
      const listed = await sceneApi.list({ campaignId });
      if (!listed.ok) return { kind: 'failed', message: listed.error.message };
      const fresh = listed.value.access.find(
        (entry) => entry.sceneId === access.sceneId,
      );
      if (!fresh) return { kind: 'failed', message: 'This scene no longer exists.' };
      return { kind: 'stale', revision: fresh.permissionRevision };
    },
    configuration: access.permissions!,
    /* Says what access does and does not cover, because a player who cannot
       open a scene here will still see it when it is presented. */
    description:
      `Who can open “${sceneName}” in the Scenes tab. Presenting a scene ` +
      'always shows it to the whole table, whatever this says.',
    levelLabel: (level) => ACCESS_LABELS[level],
    levels: LEVELS,
    revision: access.permissionRevision,
    users,
  };
}
