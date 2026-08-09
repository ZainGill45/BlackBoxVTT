import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AssetApi } from '../../../../../shared/assets';
import type { SceneApi, SceneRecord } from '../../../../../shared/scenes';
import { ScenePanel } from '../../../../../features/play/scenes/ScenePanel';
import {
  createFakeAssetApi,
  createFakeSceneApi,
  makeImageAsset,
  makeScene,
  testCampaignId,
} from '../../../../support/scenes';
import { useAssetThumbnails } from '../../../../../features/play/scenes/useAssetThumbnails';
import { useScenes } from '../../../../../features/play/scenes/useScenes';

function Harness({
  assetApi,
  canCreate = true,
  canPresent = true,
  sceneApi,
}: {
  assetApi?: AssetApi;
  canCreate?: boolean;
  canPresent?: boolean;
  sceneApi: SceneApi;
}) {
  const store = useScenes(sceneApi, testCampaignId, canPresent);
  // Mirrors PlayScreen: thumbnails are built above the panel, not inside it.
  const assetIds = useMemo(
    () =>
      store.scenes
        .map((scene) => scene.mapImage?.assetId)
        .filter((assetId): assetId is string => assetId !== undefined),
    [store.scenes],
  );
  const thumbnails = useAssetThumbnails(assetApi, testCampaignId, assetIds);
  return (
    <ScenePanel
      assetApi={assetApi}
      campaignId={testCampaignId}
      canCreate={canCreate}
      sceneApi={sceneApi}
      store={store}
      thumbnails={thumbnails}
    />
  );
}

async function renderPanel(
  scenes: SceneRecord[] = [],
  assets = [] as never[],
  provided?: SceneApi,
) {
  const sceneApi = provided ?? createFakeSceneApi(scenes);
  const assetApi = createFakeAssetApi(assets);
  render(<Harness assetApi={assetApi} sceneApi={sceneApi} />);
  if (scenes.length > 0 || provided) {
    await screen.findAllByRole('listitem');
  }
  return { assetApi, sceneApi, user: userEvent.setup() };
}

function rowFor(name: string) {
  const input = screen.getByRole('textbox', { name: `Name for ${name}` });
  const row = input.closest('li');
  if (!row) {
    throw new Error(`No row for ${name}`);
  }
  return within(row);
}

describe('ScenePanel', () => {
  it('lists scenes with their dimensions and nothing else', async () => {
    await renderPanel([
      makeScene(),
      makeScene({
        height: 600,
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Sunken Vault',
        width: 800,
      }),
    ]);

    expect(screen.getByText('1750 × 1750')).toBeInTheDocument();
    expect(screen.getByText('800 × 600')).toBeInTheDocument();
    expect(screen.queryByText(/grid/i)).not.toBeInTheDocument();
  });

  it('filters by name and clears the search', async () => {
    const { user } = await renderPanel([
      makeScene(),
      makeScene({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Sunken Vault',
      }),
    ]);

    await user.type(screen.getByRole('searchbox'), 'sunken');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear scene search' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('creates a scene and opens its settings straight away', async () => {
    const { sceneApi, user } = await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add scene' }));

    expect(sceneApi.create).toHaveBeenCalledWith({
      campaignId: testCampaignId,
    });
    expect(
      await screen.findByRole('dialog', {
        name: 'Scene settings for New Scene',
      }),
    ).toBeInTheDocument();
  });

  it('shows only viewable scenes and hides every unavailable player action', async () => {
    const inaccessible = makeScene({ name: 'Secret Vault' });
    const visible = makeScene({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Village Square',
    });
    const sceneApi = createFakeSceneApi([inaccessible, visible]);
    sceneApi.list = vi.fn(async () => ({
      ok: true as const,
      value: {
        access: [
          {
            capabilities: {
              delete: false,
              managePermissions: false,
              present: false,
              reorder: false,
              update: false,
              view: false,
            },
            permissionRevision: 0,
            permissions: null,
            sceneId: inaccessible.id,
          },
          {
            capabilities: {
              delete: false,
              managePermissions: false,
              present: false,
              reorder: false,
              update: false,
              view: true,
            },
            permissionRevision: 0,
            permissions: null,
            sceneId: visible.id,
          },
        ],
        /* The policy deliberately carries the presented scene even when it is
           absent from the player's library. The panel must still omit it. */
        activeSceneId: inaccessible.id,
        revision: 0,
        scenes: [inaccessible, visible],
      },
    }));

    render(
      <Harness
        canCreate={false}
        canPresent={false}
        sceneApi={sceneApi}
      />,
    );

    const name = await screen.findByRole('textbox', {
      name: 'Name for Village Square',
    });
    expect(name).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'Name for Secret Vault' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add scene' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Present|Edit|Delete) / }))
      .not.toBeInTheDocument();
  });

  it('renames a scene from the row input', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);

    const input = screen.getByRole('textbox', { name: 'Name for Iron Keep' });
    await user.clear(input);
    await user.type(input, 'Iron Keep Cellars');
    await user.tab();

    await waitFor(() => {
      expect(sceneApi.update).toHaveBeenCalledWith({
        campaignId: testCampaignId,
        expectedRevision: 0,
        patch: { name: 'Iron Keep Cellars' },
        sceneId: scene.id,
      });
    });
  });

  it('cancels an inline scene rename with Escape', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);
    const input = screen.getByRole('textbox', { name: 'Name for Iron Keep' });

    await user.clear(input);
    await user.type(input, 'Unsaved scene{Escape}');

    expect(input).toHaveValue('Iron Keep');
    expect(sceneApi.update).not.toHaveBeenCalled();
  });

  it('views a scene when the row itself is clicked', async () => {
    const other = makeScene({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Sunken Vault',
    });
    const { user } = await renderPanel([makeScene(), other]);

    // Nothing is presented, so nothing is viewed until a row is picked.
    expect(rowFor('Sunken Vault').getByText('1750 × 1750')).toBeInTheDocument();

    await user.click(rowFor('Sunken Vault').getByText('1750 × 1750'));

    const row = screen
      .getByRole('textbox', { name: 'Name for Sunken Vault' })
      .closest('li');
    expect(row).toHaveAttribute('data-viewing', 'true');
  });

  it('does not switch the viewed scene when a row control is used', async () => {
    const scene = makeScene();
    const { user } = await renderPanel([scene]);

    await user.click(
      screen.getByRole('textbox', { name: 'Name for Iron Keep' }),
    );

    expect(
      screen.getByRole('textbox', { name: 'Name for Iron Keep' }).closest('li'),
    ).toHaveAttribute('data-viewing', 'false');
  });

  it('marks the presented scene and follows it with the view', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);

    await user.click(
      rowFor('Iron Keep').getByRole('button', { name: 'Present Iron Keep' }),
    );

    expect(sceneApi.present).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      sceneId: scene.id,
    });
    await waitFor(() => {
      expect(
        rowFor('Iron Keep').getByRole('button', { name: 'Present Iron Keep' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
    expect(
      screen.getByRole('textbox', { name: 'Name for Iron Keep' }).closest('li'),
    ).toHaveAttribute('data-viewing', 'true');
  });

  it('requires a second click to delete a scene', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);

    await user.click(
      rowFor('Iron Keep').getByRole('button', { name: 'Delete Iron Keep' }),
    );
    expect(sceneApi.trash).not.toHaveBeenCalled();

    await user.click(
      rowFor('Iron Keep').getByRole('button', {
        name: 'Confirm deletion of Iron Keep',
      }),
    );

    expect(sceneApi.trash).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      expectedRevision: 0,
      sceneId: scene.id,
    });
    await waitFor(() => {
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
  });

  it('moves a scene from the context menu and mirrors the row actions', async () => {
    const first = makeScene();
    const second = makeScene({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Sunken Vault',
    });
    const { sceneApi, user } = await renderPanel([first, second]);

    /* Every row action is reachable from the menu as well as the row. */
    fireEvent.contextMenu(
      rowFor('Sunken Vault').getByRole('button', { name: 'View Sunken Vault' }),
    );
    for (const name of [
      'Present Scene',
      'Scene Settings',
      'Move Scene Up',
      'Move Scene Down',
      'Reorder Scene Freely',
      'Delete Scene',
    ]) {
      expect(screen.getByRole('menuitem', { name })).toBeVisible();
    }
    /* Last of two, so it can rise but not sink. */
    expect(screen.getByRole('menuitem', { name: 'Move Scene Down' })).toBeDisabled();

    await user.click(screen.getByRole('menuitem', { name: 'Move Scene Up' }));

    await waitFor(() => expect(sceneApi.reorder).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      expectedRevision: 0,
      orderedSceneIds: [second.id, first.id],
    }));
    await waitFor(() => {
      const names = screen
        .getAllByRole('textbox')
        .map((input) => (input as HTMLInputElement).value);
      expect(names).toEqual(['Sunken Vault', 'Iron Keep']);
    });
  });

  it('arms scene deletion from the context menu before committing it', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);

    fireEvent.contextMenu(
      rowFor('Iron Keep').getByRole('button', { name: 'View Iron Keep' }),
    );
    const item = screen.getByRole('menuitem', { name: 'Delete Scene' });
    await user.click(item);
    expect(item).toHaveAttribute('aria-pressed', 'true');
    expect(sceneApi.trash).not.toHaveBeenCalled();

    await user.click(item);
    await waitFor(() => expect(sceneApi.trash).toHaveBeenCalledWith({
      campaignId: testCampaignId,
      expectedRevision: 0,
      sceneId: scene.id,
    }));
  });

  it('keeps the presented scene out of the metadata line', async () => {
    const scene = makeScene();
    const { sceneApi, user } = await renderPanel([scene]);

    await user.click(
      rowFor('Iron Keep').getByRole('button', { name: 'Present Iron Keep' }),
    );
    await waitFor(() => {
      expect(sceneApi.present).toHaveBeenCalled();
    });

    expect(screen.queryByText(/presented/i)).not.toBeInTheDocument();
    expect(rowFor('Iron Keep').getByText('1750 × 1750')).toBeInTheDocument();
  });

  it('gives every row action an accessible label', async () => {
    await renderPanel([makeScene()]);

    const row = rowFor('Iron Keep');
    for (const name of ['Present Iron Keep', 'Edit Iron Keep', 'Delete Iron Keep']) {
      const button = row.getByRole('button', { name });
      expect(button).toBeEnabled();
    }
  });

  it('shows the linked map image in the row preview', async () => {
    const asset = makeImageAsset();
    await renderPanel(
      [
        makeScene({
          mapImage: {
            assetId: asset.id,
            height: 600,
            rotation: 0,
            width: 800,
            x: 0,
            y: 0,
          },
        }),
      ],
      [asset] as never,
    );

    await waitFor(() => {
      expect(
        rowFor('Iron Keep')
          .getByRole('button', { name: 'View Iron Keep' })
          .querySelector('img'),
      ).toHaveAttribute('src', `blackbox-asset://token/${asset.id}`);
    });
    // Never block the main thread decoding a map to paint a 59px thumbnail.
    expect(
      rowFor('Iron Keep')
        .getByRole('button', { name: 'View Iron Keep' })
        .querySelector('img'),
    ).toHaveAttribute('decoding', 'async');
  });

  it('grants one player access to a scene from its context menu', async () => {
    const playerId = '99999999-9999-4999-8999-999999999999';
    const sceneApi = createFakeSceneApi([makeScene({ name: 'Iron Keep' })]);
    sceneApi.listUsers = vi.fn(async () => ({
      ok: true as const,
      value: [{ id: playerId, username: 'Chris' }],
    }));
    const { user } = await renderPanel([], [], sceneApi);

    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Name for Iron Keep' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));

    const permissions = screen.getByRole('dialog', { name: 'Edit Permissions' });
    expect(permissions).toHaveTextContent('Iron Keep');
    // Presenting is not what this governs, and the editor says so.
    expect(permissions).toHaveTextContent(/Presenting a scene always shows it/);
    expect(
      within(permissions).queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();

    await user.click(within(permissions).getByRole('button', { name: 'Chris permission' }));
    await user.click(
      within(within(permissions).getByRole('group', {
        name: 'Chris permission options',
      })).getByRole('button', { name: 'View' }),
    );

    await waitFor(() => expect(sceneApi.updatePermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: testCampaignId,
        expectedPermissionRevision: 0,
        permissions: {
          allPlayers: 'none',
          overrides: [{ access: 'view', userId: playerId }],
        },
      }),
    ), { timeout: 3_000 });
  });
});
