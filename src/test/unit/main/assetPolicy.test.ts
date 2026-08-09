import { describe, expect, it } from 'vitest';
import {
  authenticatedAssetPolicy,
  getAssetCapabilities,
} from '../../../main/assetPolicy';
import type { AssetActor } from '../../../shared/assets';

const gm: AssetActor = { id: 'gm-id', role: 'gm' };
const player: AssetActor = { id: 'player-id', role: 'player' };

describe('authenticatedAssetPolicy', () => {
  it('grants reorder to the Game Master alone', () => {
    expect(authenticatedAssetPolicy.authorize({ action: 'reorder', subject: gm }))
      .toBe(true);
    expect(
      authenticatedAssetPolicy.authorize({ action: 'reorder', subject: player }),
    ).toBe(false);
  });

  it('leaves every other action open to players', () => {
    /* Reorder is the first action the policy narrows by role, so this guards
       against the narrowing being widened by accident. */
    const capabilities = getAssetCapabilities(authenticatedAssetPolicy, player);
    expect(capabilities).toEqual({
      delete: true,
      import: true,
      list: true,
      preview: true,
      read: true,
      rename: true,
      reorder: false,
    });
  });

  it('reports every action for the Game Master', () => {
    expect(getAssetCapabilities(authenticatedAssetPolicy, gm)).toEqual({
      delete: true,
      import: true,
      list: true,
      preview: true,
      read: true,
      rename: true,
      reorder: true,
    });
  });
});
