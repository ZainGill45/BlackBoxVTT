import type {
  AssetAccessLevel,
  AssetAction,
  AssetActor,
  AssetCapability,
  AssetRecord,
} from '../shared/assets';

const ACTIONS: AssetAction[] = [
  'list',
  'read',
  'preview',
  'import',
  'rename',
  'delete',
  'reorder',
  'managePermissions',
];

interface AssetAuthorizationContext {
  /** The subject's access to this asset. Absent means the library default. */
  access?: AssetAccessLevel;
  action: AssetAction;
  asset?: AssetRecord;
  subject: AssetActor;
}

export interface AssetPolicy {
  authorize(context: AssetAuthorizationContext): boolean;
}

export const authenticatedAssetPolicy: AssetPolicy = {
  authorize({ access = 'none', action, asset, subject }) {
    if (subject.role === 'gm') return true;
    if (subject.role !== 'player') return false;
    switch (action) {
      /* Ordering the shared library and granting access to it are the Game
         Master's, so that a player cannot rearrange or reopen what everyone
         else sees. */
      case 'managePermissions':
      case 'reorder':
        return false;
      /* Adding to the library stays open; the importer is granted access to
         what they added rather than to everything. */
      case 'import':
        return true;
      /* Reading bytes and resolving them to an image is what puts a map on the
         table and an embedded image on a Journal page, and a player reaches
         both through content they can already see. Gating either would blank
         the scene of anyone who was not also handed the file in Storage, so
         access curates the library instead of sealing the file. */
      case 'read':
      case 'preview':
        return true;
      case 'rename':
      case 'delete':
        return access === 'edit';
      /* Asked about the campaign, this is "may you hold a library at all",
         which every player may; asked about one asset, it is "may this be in
         it", which is the grant. A player must keep receiving the manifest
         either way, because that is what feeds the images they can see. */
      case 'list':
        return asset ? access === 'edit' || access === 'view' : true;
      default:
        return false;
    }
  },
};

export function getAssetCapabilities(
  policy: AssetPolicy,
  subject: AssetActor,
  asset?: AssetRecord,
  access?: AssetAccessLevel,
): AssetCapability {
  return Object.fromEntries(
    ACTIONS.map((action) => [
      action,
      policy.authorize({ access, action, asset, subject }),
    ]),
  ) as unknown as AssetCapability;
}
