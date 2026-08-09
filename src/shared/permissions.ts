/**
 * Access control shared by every subject a user can grant access to.
 *
 * The container is deliberately generic in its access level: a subject decides
 * which levels it offers, and nothing here knows what a Journal, a scene, or an
 * asset is. One default for all players plus per-user exceptions is the whole
 * model.
 */

/** Coalescing window for permission edits, matching the Journal's autosave feel. */
export const PERMISSION_AUTOSAVE_DELAY_MS = 750;

export interface PermissionOverride<TAccess extends string> {
  access: TAccess;
  userId: string;
}

export interface PermissionConfiguration<TAccess extends string> {
  allPlayers: TAccess;
  overrides: PermissionOverride<TAccess>[];
}

export interface PermissionSubject {
  id: string;
  username: string;
}

export function clonePermissionConfiguration<TAccess extends string>(
  configuration: PermissionConfiguration<TAccess>,
): PermissionConfiguration<TAccess> {
  return {
    allPlayers: configuration.allPlayers,
    overrides: configuration.overrides.map((override) => ({ ...override })),
  };
}

export function permissionAccessFor<TAccess extends string>(
  configuration: PermissionConfiguration<TAccess>,
  userId: string | null,
): TAccess {
  return userId
    ? configuration.overrides.find((override) => override.userId === userId)
      ?.access ?? configuration.allPlayers
    : configuration.allPlayers;
}

export function samePermissionConfiguration<TAccess extends string>(
  left: PermissionConfiguration<TAccess>,
  right: PermissionConfiguration<TAccess>,
): boolean {
  if (
    left.allPlayers !== right.allPlayers ||
    left.overrides.length !== right.overrides.length
  ) return false;
  const byUser = new Map(left.overrides.map(({ access, userId }) => [userId, access]));
  return right.overrides.every(({ access, userId }) => byUser.get(userId) === access);
}

/** Sets one user's access, dropping the override when they return to the default. */
export function withPermissionOverride<TAccess extends string>(
  configuration: PermissionConfiguration<TAccess>,
  userId: string,
  access: TAccess | null,
): PermissionConfiguration<TAccess> {
  const overrides = configuration.overrides.filter(
    (override) => override.userId !== userId,
  );
  return {
    ...configuration,
    overrides: access === null ? overrides : [...overrides, { access, userId }],
  };
}
