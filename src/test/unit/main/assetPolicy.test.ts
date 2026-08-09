import { describe, expect, it } from 'vitest';
import {
  authenticatedAssetPolicy,
  getAssetCapabilities,
} from '../../../main/assetPolicy';
import type { AssetActor, AssetRecord } from '../../../shared/assets';

const gm: AssetActor = { id: 'gm-id', role: 'gm' };
const player: AssetActor = { id: 'player-id', role: 'player' };
const asset = { id: 'asset-id' } as unknown as AssetRecord;

describe('authenticatedAssetPolicy', () => {
  it('keeps ordering and granting access to the Game Master alone', () => {
    for (const action of ['reorder', 'managePermissions'] as const) {
      expect(authenticatedAssetPolicy.authorize({ action, subject: gm }))
        .toBe(true);
      expect(
        authenticatedAssetPolicy.authorize({ access: 'edit', action, subject: player }),
      ).toBe(false);
    }
  });

  it('lets any player hold a library, and asks per asset what is in it', () => {
    /* Asked about the campaign rather than an asset, listing is what keeps the
       manifest flowing, and the manifest is what feeds the images a player can
       already see on the table. */
    expect(getAssetCapabilities(authenticatedAssetPolicy, player)).toEqual({
      delete: false,
      import: true,
      list: true,
      managePermissions: false,
      preview: true,
      read: true,
      rename: false,
      reorder: false,
    });
    expect(getAssetCapabilities(authenticatedAssetPolicy, player, asset)).toEqual({
      delete: false,
      import: true,
      list: false,
      managePermissions: false,
      /* Resolving an image is not a library privilege: it is what draws a map
         the player is already looking at. */
      preview: true,
      read: true,
      rename: false,
      reorder: false,
    });
  });

  it('lets a viewer find and open an asset but not change it', () => {
    expect(getAssetCapabilities(authenticatedAssetPolicy, player, asset, 'view'))
      .toEqual({
        delete: false,
        import: true,
        list: true,
        managePermissions: false,
        preview: true,
        read: true,
        rename: false,
        reorder: false,
      });
  });

  it('lets an editor rename and delete the asset they were granted', () => {
    expect(getAssetCapabilities(authenticatedAssetPolicy, player, asset, 'edit'))
      .toEqual({
        delete: true,
        import: true,
        list: true,
        managePermissions: false,
        preview: true,
        read: true,
        rename: true,
        reorder: false,
      });
  });

  /* Reading is what renders a map image or an embedded Journal image, and a
     player reaches those through content they can already see. Access curates
     the Storage library rather than sealing the file. */
  it('keeps reading and rendering open to a player with no access to the library', () => {
    for (const action of ['read', 'preview'] as const) {
      expect(
        authenticatedAssetPolicy.authorize({ access: 'none', action, asset, subject: player }),
      ).toBe(true);
    }
  });

  it('reports every action for the Game Master', () => {
    expect(getAssetCapabilities(authenticatedAssetPolicy, gm)).toEqual({
      delete: true,
      import: true,
      list: true,
      managePermissions: true,
      preview: true,
      read: true,
      rename: true,
      reorder: true,
    });
  });
});
