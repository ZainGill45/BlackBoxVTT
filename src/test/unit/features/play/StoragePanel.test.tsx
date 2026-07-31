import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  AssetApi,
  AssetCapability,
  AssetView,
} from '../../../../shared/assets';
import { makeScene } from '../../../support/scenes';
import { StoragePanel } from '../../../../features/play/StoragePanel';

const capabilities: AssetCapability = {
  delete: true,
  import: true,
  list: true,
  preview: true,
  read: true,
  rename: true,
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
  const pickAndImport = vi.fn(async () => ({
    ok: true as const,
    value: initial,
  }));
  const api: AssetApi = {
    getPreview: vi.fn(),
    list: vi.fn(async () => ({ ok: true as const, value: initial })),
    onChanged: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
    pickAndImport,
    prepareRemote: vi.fn(),
    releasePreview: vi.fn(),
    rename,
    trash,
  };
  return { api, pickAndImport, rename, trash };
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
      <StoragePanel
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
      <StoragePanel
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
      <StoragePanel
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
      name: 'Delete an image that scenes use?',
    });
    expect(prompt).toHaveTextContent('Map.png is placed in 2 scenes.');
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
          name: 'Delete an image that scenes use?',
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
      <StoragePanel
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
        name: 'Delete an image that scenes use?',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps the large storage icon when no assets exist', async () => {
    const { api } = createApi([]);
    const { container } = render(
      <StoragePanel
        assetApi={api}
        campaignId="33333333-3333-4333-8333-333333333333"
      />,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(
      container.querySelector('[data-sidebar-icon="storage"] svg'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add campaign assets' })).toBeVisible();
  });
});
