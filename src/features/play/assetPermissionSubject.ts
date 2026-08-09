import type { PermissionsModalSubject } from '../../components/ui/PermissionsModal';
import {
  ASSET_ACCESS_LEVELS,
  type AssetAccessLevel,
  type AssetApi,
  type AssetView,
} from '../../shared/assets';
import type { PermissionSubject } from '../../shared/permissions';

const ACCESS_LABELS: Record<AssetAccessLevel, string> = {
  edit: 'Edit',
  none: 'No access',
  view: 'View',
};

export function assetPermissionSubject({
  asset,
  assetApi,
  campaignId,
  onUpdated,
  users,
}: {
  asset: AssetView;
  assetApi: AssetApi;
  campaignId: string;
  onUpdated: (updated: AssetView) => void;
  users: readonly PermissionSubject[];
}): PermissionsModalSubject<AssetAccessLevel> {
  return {
    async commit(permissions, revision) {
      const result = await assetApi.updatePermissions({
        assetId: asset.id,
        campaignId,
        expectedPermissionRevision: revision,
        permissions,
      });
      if (result.ok) {
        onUpdated(result.value);
        return { kind: 'ok' };
      }
      if (result.error.code !== 'conflict') {
        return { kind: 'failed', message: result.error.message };
      }
      const listed = await assetApi.list({ campaignId });
      if (!listed.ok) return { kind: 'failed', message: listed.error.message };
      const fresh = listed.value.find(({ id }) => id === asset.id);
      if (!fresh) return { kind: 'failed', message: 'That asset no longer exists.' };
      onUpdated(fresh);
      return { kind: 'stale', revision: fresh.permissionRevision };
    },
    configuration: asset.permissions!,
    /* Says what access does and does not cover, because a player who cannot see
       a map in Storage can still see it on the table. */
    description:
      `Who can find “${asset.displayName}” in Storage. Images already on a ` +
      'scene or a Journal page stay visible to anyone who can see them.',
    levelLabel: (level) => ACCESS_LABELS[level],
    levels: ASSET_ACCESS_LEVELS,
    revision: asset.permissionRevision,
    users,
  };
}
