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
  authorize({ subject }) {
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
