import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type {
  AssetApi,
  AssetCapability,
  AssetView,
} from '../../../../shared/assets';
import { makeScene } from '../../../support/scenes';
import { StoragePanel } from '../../../../features/play/StoragePanel';
import { useAssets } from '../../../../features/play/useAssets';

/**
 * The library lives above the sidebar in the real screen, so the panel is
 * exercised through the same store the play screen builds for it rather than
 * against a hand-made one.
 */
function StoragePanelHarness({
  assetApi,
  campaignId,
  ...rest
}: Omit<ComponentProps<typeof StoragePanel>, 'assetStore'>) {
  return (
    <StoragePanel
      assetApi={assetApi}
      assetStore={useAssets(assetApi, campaignId)}
      campaignId={campaignId}
      {...rest}
    />
  );
}

const capabilities: AssetCapability = {
  delete: true,
  import: true,
  list: true,
  managePermissions: true,
  preview: true,
  read: true,
  rename: true,
  reorder: true,
};

function asset(
  id: string,
  displayName: string,
  kind: AssetView['kind'],
  format: AssetView['format'],
): AssetView {
  return {
    available: true,
    capabilities,
    permissionRevision: 0,
    permissions: { allPlayers: 'none' as const, overrides: [] },
    chunkHashes: [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'gm',
    displayName,
    extension: format === 'jpeg' ? 'jpg' : format,
    fileModifiedAtMs: 1,
    format,
    id,
    kind,
    lastModifiedAt: '2026-01-01T00:00:00.000Z',
    lastModifiedBy: 'gm',
    mimeType: kind === 'image' ? 'image/png' : 'audio/mpeg',
    originalFilename: displayName,
    revision: 1,
    sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    sizeBytes: 2048,
    syncState: 'ready',
  };
}

function createApi(initial: AssetView[]) {
  const rename = vi.fn(async (input) => {
    const current = initial.find((candidate) => candidate.id === input.assetId)!;
    return {
      ok: true as const,
      value: {
        ...current,
        displayName: input.displayName,
        revision: current.revision + 1,
      },
    };
  });
  const trash = vi.fn(async () => ({ ok: true as const, value: null }));
  /* Applies the permutation the way the repository does — the group's assets
     are written back into the slots that group already occupied — so a test can
     assert on rendered order rather than only on the call arguments. */
  const reorder = vi.fn(async (input) => {
    const slots: number[] = [];
    initial.forEach((candidate, index) => {
      if (candidate.kind === input.kind) slots.push(index);
    });
    const byId = new Map(initial.map((candidate) => [candidate.id, candidate]));
    const value = [...initial];
    slots.forEach((slot, position) => {
      value[slot] = byId.get(input.orderedAssetIds[position])!;
    });
    return { ok: true as const, value };
  });
  const pickAndImport = vi.fn(async () => ({
    ok: true as const,
    value: initial,
  }));
  const listUsers = vi.fn(async () => ({
    ok: true as const,
    value: [{ id: '99999999-9999-4999-8999-999999999999', username: 'Chris' }],
  }));
  const updatePermissions = vi.fn(async (
    input: Parameters<AssetApi['updatePermissions']>[0],
  ) => ({
    ok: true as const,
    value: {
      ...initial.find(({ id }) => id === input.assetId)!,
      permissionRevision: input.expectedPermissionRevision + 1,
      permissions: input.permissions,
    },
  }));
  const api: AssetApi = {
    getPreview: vi.fn(),
    importImageBytes: vi.fn(),
    list: vi.fn(async () => ({ ok: true as const, value: initial })),
    listUsers,
    updatePermissions,
    onChanged: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
    pickAndImport,
    pickImages: vi.fn(),
    preparePreviews: vi.fn(),
    prepareRemote: vi.fn(),
    releasePreview: vi.fn(),
    rename,
    reorder,
    trash,
  };
  return { api, pickAndImport, rename, reorder, trash, updatePermissions };
}

describe('StoragePanel', () => {
  it('renders nonempty groups collapsed in fixed order and expands search matches', async () => {
    const user = userEvent.setup();
    const { api } = createApi([
      asset(
        '11111111-1111-4111-8111-111111111111',
        'Map.png',
        'image',
        'png',
      ),
      asset(
        '22222222-2222-4222-8222-222222222222',
        'Song.mp3',
        'audio',
        'mp3',
      ),
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );

    expect(await screen.findByRole('button', { name: 'Images' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Documents' })).toBeNull();
    const groupButtons = screen
      .getAllByRole('button')
      .filter((button) => ['Images', 'Audio'].includes(button.textContent ?? ''));
    expect(groupButtons.map((button) => button.textContent)).toEqual([
      'Images',
      'Audio',
    ]);

    await user.type(screen.getByPlaceholderText('Search assets'), 'song');
    expect(screen.queryByRole('button', { name: 'Images' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('Name for Song.mp3')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear asset search' }));
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('saves names on blur and requires two delete activations', async () => {
    const user = userEvent.setup();
    const original = asset(
      '11111111-1111-4111-8111-111111111111',
      'Map.png',
      'image',
      'png',
    );
    const { api, rename, trash } = createApi([original]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));
    const name = screen.getByLabelText('Name for Map.png');
    await user.clear(name);
    await user.type(name, 'World Map.png');
    await user.tab();
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({
        assetId: original.id,
        campaignId: '33333333-3333-4333-8333-333333333333',
        displayName: 'World Map.png',
        expectedRevision: 1,
      }),
    );

    const row = screen.getByLabelText('Name for World Map.png').closest('li')!;
    const deleteButton = within(row).getByRole('button', {
      name: 'Delete World Map.png',
    });
    expect(deleteButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(deleteButton);
    expect(trash).not.toHaveBeenCalled();
    const confirmButton = within(row).getByRole('button', {
      name: 'Confirm deletion of World Map.png',
    });
    expect(confirmButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(confirmButton);
    expect(trash).toHaveBeenCalledOnce();
  });

  it('names the scenes that depend on an image before deleting it', async () => {
    const user = userEvent.setup();
    const original = asset(
      '11111111-1111-4111-8111-111111111111',
      'Map.png',
      'image',
      'png',
    );
    const { api, trash } = createApi([original]);
    const onDetachFromScenes = vi.fn(async () => undefined);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
        onDetachFromScenes={onDetachFromScenes}
        onFindSceneDependents={async () => [
          makeScene({ name: 'Iron Keep' }),
          makeScene({
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Sunken Vault',
          }),
        ]}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));

    await user.click(screen.getByRole('button', { name: 'Delete Map.png' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm deletion of Map.png' }),
    );

    const prompt = await screen.findByRole('dialog', {
      name: 'Delete an image that campaign content uses?',
    });
    expect(prompt).toHaveTextContent('Map.png is used by 2 scene(s) and 0 Journal page(s).');
    expect(within(prompt).getByText('Iron Keep')).toBeInTheDocument();
    expect(within(prompt).getByText('Sunken Vault')).toBeInTheDocument();
    expect(trash).not.toHaveBeenCalled();

    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    expect(trash).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Map.png' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm deletion of Map.png' }),
    );
    await user.click(
      within(
        await screen.findByRole('dialog', {
          name: 'Delete an image that campaign content uses?',
        }),
      ).getByRole('button', { name: 'Delete anyway' }),
    );

    expect(trash).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(onDetachFromScenes).toHaveBeenCalledWith(original.id);
    });
  });

  it('deletes an unused image without a second prompt', async () => {
    const user = userEvent.setup();
    const { api, trash } = createApi([
      asset('11111111-1111-4111-8111-111111111111', 'Map.png', 'image', 'png'),
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
        onFindSceneDependents={async () => []}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));

    await user.click(screen.getByRole('button', { name: 'Delete Map.png' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm deletion of Map.png' }),
    );

    await waitFor(() => expect(trash).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('dialog', {
        name: 'Delete an image that campaign content uses?',
      }),
    ).not.toBeInTheDocument();
  });

  it('moves an asset within its group from the context menu', async () => {
    const user = userEvent.setup();
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    const { api, reorder } = createApi([
      asset(first, 'Alpha.png', 'image', 'png'),
      asset(second, 'Beta.png', 'image', 'png'),
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));

    /* The topmost asset cannot move up, so its Move Image Up is disabled. */
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Preview Alpha.png' }));
    expect(screen.getByRole('menuitem', { name: 'Move Image Up' })).toBeDisabled();
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Preview Beta.png' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move Image Up' }));

    await waitFor(() => expect(reorder).toHaveBeenCalledWith({
      campaignId: '33333333-3333-4333-8333-333333333333',
      kind: 'image',
      orderedAssetIds: [second, first],
    }));
    await waitFor(() => {
      const names = screen
        .getAllByRole('textbox')
        .map((input) => (input as HTMLInputElement).value);
      expect(names).toEqual(['Beta.png', 'Alpha.png']);
    });
  });

  it('arms deletion from the context menu before committing it', async () => {
    const user = userEvent.setup();
    const { api, trash } = createApi([
      asset('11111111-1111-4111-8111-111111111111', 'Map.png', 'image', 'png'),
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Preview Map.png' }));

    const item = screen.getByRole('menuitem', { name: 'Delete Image' });
    await user.click(item);
    expect(item).toHaveAttribute('aria-pressed', 'true');
    expect(trash).not.toHaveBeenCalled();

    await user.click(item);
    await waitFor(() => expect(trash).toHaveBeenCalledOnce());
  });

  it('grants one player access to an asset from its row, saving as it changes', async () => {
    const user = userEvent.setup();
    const playerId = '99999999-9999-4999-8999-999999999999';
    const { api, updatePermissions } = createApi([
      asset('11111111-1111-4111-8111-111111111111', 'Map.png', 'image', 'png'),
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Images' }));
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Name for Map.png' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));

    const permissions = screen.getByRole('dialog', { name: 'Edit Permissions' });
    expect(permissions).toHaveTextContent('Map.png');
    expect(
      within(permissions).queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();

    await user.click(within(permissions).getByRole('button', { name: 'Chris permission' }));
    await user.click(
      within(within(permissions).getByRole('group', {
        name: 'Chris permission options',
      })).getByRole('button', { name: 'View' }),
    );

    await waitFor(() => expect(updatePermissions).toHaveBeenCalledWith({
      assetId: '11111111-1111-4111-8111-111111111111',
      campaignId: '33333333-3333-4333-8333-333333333333',
      expectedPermissionRevision: 0,
      permissions: {
        allPlayers: 'none',
        overrides: [{ access: 'view', userId: playerId }],
      },
    }), { timeout: 3_000 });
  });

  it('re-reads the roster when the permissions editor opens', async () => {
    const user = userEvent.setup();
    const { api } = createApi([
      asset('11111111-1111-4111-8111-111111111111', 'Map.png', 'image', 'png'),
    ]);
    /* The campaign opens with nobody on it, and a player is added in server
       settings afterwards - so a roster read once, on the way in, would leave
       the editor with nobody to grant anything to. */
    let roster: { id: string; username: string }[] = [];
    let resolveOldRoster:
      | ((result: Awaited<ReturnType<AssetApi['listUsers']>>) => void)
      | undefined;
    vi.mocked(api.listUsers)
      .mockImplementationOnce(
        () =>
          new Promise<Awaited<ReturnType<AssetApi['listUsers']>>>(
            (resolve) => {
              resolveOldRoster = resolve;
            },
          ),
      )
      .mockImplementation(async () => ({
        ok: true as const,
        value: roster,
      }));

    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Images' }));

    roster = [{ id: '99999999-9999-4999-8999-999999999999', username: 'Chris' }];

    fireEvent.contextMenu(
      screen.getByRole('textbox', { name: 'Name for Map.png' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));

    const permissions = screen.getByRole('dialog', { name: 'Edit Permissions' });
    expect(
      await within(permissions).findByRole('button', {
        name: 'Chris permission',
      }),
    ).toBeVisible();

    await act(async () => {
      resolveOldRoster?.({ ok: true, value: [] });
    });
    expect(
      within(permissions).getByRole('button', {
        name: 'Chris permission',
      }),
    ).toBeVisible();
  });

  it('keeps an asset the player was not granted out of the library', async () => {
    const withheld = asset(
      '11111111-1111-4111-8111-111111111111',
      'Secret Map.png',
      'image',
      'png',
    );
    /* Its bytes still arrive, which is what keeps it rendering on a scene the
       player can see; it is simply not theirs to browse. */
    const { api } = createApi([
      { ...withheld, capabilities: { ...withheld.capabilities, list: false } },
    ]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );

    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Images' })).not.toBeInTheDocument();
    expect(screen.queryByText('Secret Map.png')).not.toBeInTheDocument();
  });

  it('offers asset import when no assets exist', async () => {
    const { api } = createApi([]);
    render(
      <StoragePanelHarness
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Add campaign assets' })).toBeVisible();
  });
});
