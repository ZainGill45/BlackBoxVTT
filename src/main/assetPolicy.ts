import type {
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
];

interface AssetAuthorizationContext {
  action: AssetAction;
  asset?: AssetRecord;
  subject: AssetActor;
}

export interface AssetPolicy {
  authorize(context: AssetAuthorizationContext): boolean;
}

export const authenticatedAssetPolicy: AssetPolicy = {
  authorize({ action, subject }) {
    /* Ordering the shared library is the Game Master's, so that a player
       cannot rearrange what everyone else sees. */
    if (action === 'reorder') return subject.role === 'gm';
    return subject.role === 'gm' || subject.role === 'player';
  },
};

export function getAssetCapabilities(
  policy: AssetPolicy,
  subject: AssetActor,
  asset?: AssetRecord,
): AssetCapability {
  return Object.fromEntries(
    ACTIONS.map((action) => [
      action,
      policy.authorize({ action, asset, subject }),
    ]),
  ) as unknown as AssetCapability;
}
