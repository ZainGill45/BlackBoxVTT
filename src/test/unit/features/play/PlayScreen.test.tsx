import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayScreen } from '../../../../features/play/PlayScreen';
import {
  createFakeAssetApi,
  createFakeSceneApi,
  makeScene,
} from '../../../support/scenes';
import { createMockNetworkApi } from '../../../support/networkApi';
import { createDefaultServerSettings } from '../../../../features/play/serverSettings';
import type { PlayScreenProps } from '../../../../features/play/types';
import type { AssetView } from '../../../../shared/assets';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';

const playerSession: PlayScreenProps['session'] = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  campaignName: 'Remote Campaign',
  host: 'vtt.local',
  port: 43_110,
  role: 'player',
  source: 'remote',
  system: TEST_CAMPAIGN_SYSTEM,
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

const gmSession: PlayScreenProps['session'] = {
  campaignId: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  campaignName: 'Iron Meridian',
  role: 'gm',
  source: 'local',
  system: TEST_CAMPAIGN_SYSTEM,
};

const storedImage: AssetView = {
  available: true,
  capabilities: {
    delete: true,
    import: true,
    list: true,
    managePermissions: true,
    preview: true,
    read: true,
    rename: true,
    reorder: true,
  },
  chunkHashes: [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'gm',
  displayName: 'Keep gatehouse',
  extension: 'png',
  fileModifiedAtMs: 1,
  format: 'png',
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'image',
  lastModifiedAt: '2026-01-01T00:00:00.000Z',
  lastModifiedBy: 'gm',
  mimeType: 'image/png',
  originalFilename: 'gatehouse.png',
  permissionRevision: 0,
  permissions: { allPlayers: 'none', overrides: [] },
  revision: 1,
  sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  sizeBytes: 2048,
  syncState: 'ready',
};

function renderPlayScreen(
  overrides: Partial<PlayScreenProps> = {},
) {
  const props: PlayScreenProps = {
    applicationApi: window.blackBox.application,
    assetApi: createFakeAssetApi(),
    networkApi: createMockNetworkApi(),
    onExit: vi.fn(),
    onLogout: vi.fn(),
    sceneApi: createFakeSceneApi(),
    session: playerSession,
    ...overrides,
  };

  render(<PlayScreen {...props} />);
  return props;
}

beforeEach(() => localStorage.clear());

describe('PlayScreen', () => {
  it('renders the player shell without GM-only controls', () => {
    renderPlayScreen();

    expect(
      screen.getByRole('heading', {
        name: 'Remote campaign at vtt.local:43110 — Player',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Map play area for vtt.local:43110',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fog' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('toolbar', { name: 'Map layers' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const playControls = screen.getByRole('toolbar', {
      name: 'Play controls',
    });
    expect(
      within(playControls)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Exit application',
      'Logout',
      'Select',
      'Measure',
      'Paint',
      'Shape',
      'Text',
    ]);
  });

  it('changes tools without rendering the removed quick-action bar', async () => {
    const user = userEvent.setup();
    const onToolChange = vi.fn();
    renderPlayScreen({ onToolChange });

    await user.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByRole('button', { name: 'Measure' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(onToolChange).toHaveBeenCalledWith('measure');

    expect(
      screen.queryByRole('toolbar', { name: 'Quick actions' }),
    ).not.toBeInTheDocument();
    for (const label of [
      'Roll Dice',
      'Initiative',
      'End Turn',
      'Ping Map',
      'Center View',
      'Notes',
    ]) {
      expect(
        screen.queryByRole('button', { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it('keeps the Paint rail open and exposes compact Freeform and Polyline settings', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    await user.click(screen.getByRole('button', { name: 'Paint' }));
    const rail = screen.getByRole('toolbar', { name: 'Paint tools' });
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Paint settings', 'Freeform paint', 'Polyline pen']);
    expect(
      within(rail).getByRole('button', { name: 'Freeform paint' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      within(rail).getByRole('button', { name: 'Polyline pen' }),
    );
    expect(
      within(rail).getByRole('button', { name: 'Polyline pen' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(
      within(rail).getByRole('button', { name: 'Paint settings' }),
    );

    const paintDialog = screen.getByRole('dialog', {
      name: 'Paint settings',
    });
    expect(paintDialog).toHaveFocus();
    expect(document.getElementById('freeform-color-picker')).not.toHaveFocus();
    expect(
      within(paintDialog).queryByRole('heading', {
        name: 'Paint settings',
      }),
    ).not.toBeInTheDocument();
    expect(within(paintDialog).queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Drawing tools')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'These preferences are private to you and saved for this campaign.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Done' }),
    ).not.toBeInTheDocument();

    const freeformSettings = screen.getByRole('region', {
      name: 'Freeform Brush',
    });
    const polylineSettings = screen.getByRole('region', {
      name: 'Polyline Brush',
    });
    expect(
      within(polylineSettings).getByLabelText('Width'),
    ).toHaveValue(16);
    const fillSelect = within(polylineSettings).getByLabelText('Fill');
    expect(fillSelect).toHaveValue('off');
    expect(
      within(polylineSettings).queryByLabelText('Fill color'),
    ).not.toBeInTheDocument();

    const textColor = (id: string) => {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Expected ${id}.`);
      }
      return input;
    };
    const strokeColor = textColor('polyline-color-text');
    await user.clear(strokeColor);
    await user.type(strokeColor, '#ababab{Enter}');

    await user.selectOptions(fillSelect, 'on');
    expect(textColor('polyline-fill-color-text')).toHaveValue('#ababab');
    const fillColor = textColor('polyline-fill-color-text');
    await user.clear(fillColor);
    await user.type(fillColor, '#cccccc{Enter}');

    await user.selectOptions(fillSelect, 'off');
    expect(
      within(polylineSettings).queryByLabelText('Fill color'),
    ).not.toBeInTheDocument();
    await user.selectOptions(fillSelect, 'on');
    expect(textColor('polyline-fill-color-text')).toHaveValue('#cccccc');

    await user.clear(textColor('polyline-color-text'));
    await user.type(
      textColor('polyline-color-text'),
      '#dddddd{Enter}',
    );
    expect(textColor('polyline-fill-color-text')).toHaveValue('#cccccc');

    expect(within(freeformSettings).getByLabelText('Width')).toHaveValue(
      16,
    );
    expect(within(freeformSettings).getByLabelText('Hardness')).toHaveValue(
      100,
    );
  });

  it('commits, clamps, and reverts compact paint number fields', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    await user.click(screen.getByRole('button', { name: 'Paint' }));
    const rail = screen.getByRole('toolbar', { name: 'Paint tools' });
    await user.click(
      within(rail).getByRole('button', { name: 'Paint settings' }),
    );

    const freeformSettings = screen.getByRole('region', {
      name: 'Freeform Brush',
    });
    const width = within(freeformSettings).getByLabelText('Width');
    await user.clear(width);
    await user.type(width, '999{Enter}');
    expect(width).toHaveValue(256);

    await user.clear(width);
    await user.type(width, '0');
    await user.tab();
    expect(width).toHaveValue(1);

    await user.clear(width);
    await user.type(width, '42');
    await user.keyboard('{Escape}');
    expect(width).toHaveValue(1);

    const opacity = within(freeformSettings).getByLabelText('Opacity');
    await user.clear(opacity);
    await user.type(opacity, '37.6{Enter}');
    expect(opacity).toHaveValue(38);

    const hardness = within(freeformSettings).getByLabelText('Hardness');
    await user.clear(hardness);
    await user.type(hardness, '73{Enter}');
    expect(hardness).toHaveValue(73);
  });

  it('keeps a Text settings rail and saves all authoring defaults locally', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    await user.click(screen.getByRole('button', { name: 'Text' }));
    const rail = screen.getByRole('toolbar', { name: 'Text tools' });
    expect(within(rail).getAllByRole('button')).toHaveLength(1);
    await user.click(
      within(rail).getByRole('button', { name: 'Text settings' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Text settings' });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByLabelText('Font family')).not.toHaveFocus();
    expect(within(dialog).getByLabelText('Font family')).toHaveValue('inter');
    expect(within(dialog).getByLabelText('Font weight')).toHaveValue('400');
    expect(within(dialog).getByLabelText('Font size')).toHaveValue(64);
    expect(within(dialog).getByLabelText('Stroke width')).toHaveValue(8);
    expect(within(dialog).getByLabelText('Primary color')).toHaveValue(
      '#ffffff',
    );
    expect(within(dialog).getByLabelText('Stroke color')).toHaveValue(
      '#000000',
    );

    await user.selectOptions(within(dialog).getByLabelText('Font family'), 'lora');
    await user.selectOptions(within(dialog).getByLabelText('Font weight'), '700');
    const fontSize = within(dialog).getByLabelText('Font size');
    await user.clear(fontSize);
    await user.type(fontSize, '999{Enter}');
    const strokeWidth = within(dialog).getByLabelText('Stroke width');
    await user.clear(strokeWidth);
    await user.type(strokeWidth, '-5{Enter}');
    const primary = within(dialog).getByLabelText('Primary color');
    await user.clear(primary);
    await user.type(primary, '#ABCDEF{Enter}');

    expect(fontSize).toHaveValue(256);
    expect(strokeWidth).toHaveValue(0);
    expect(primary).toHaveValue('#abcdef');
    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem(
            `blackboxvtt:text:${playerSession.campaignId}:player-${playerSession.userId}`,
          ) ?? '{}',
        ),
      ).toMatchObject({
        fontFamily: 'lora',
        fontSize: 256,
        fontWeight: 700,
        primaryColor: '#abcdef',
        strokeWidth: 0,
      });
    });
  });

  it('keeps the Shape subtool active and persists every authoring group', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    await user.click(screen.getByRole('button', { name: 'Shape' }));
    const rail = screen.getByRole('toolbar', { name: 'Shape tools' });
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Shape settings', 'Sphere', 'Square', 'Cone']);
    expect(within(rail).getByRole('button', { name: 'Sphere' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(rail).getByRole('button', { name: 'Cone' }));
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    expect(screen.getByRole('button', { name: 'Cone' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Shape settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Shape settings' });
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Background', 'Stroke', 'Measurement labels']);
    expect(within(dialog).getByLabelText('Background type')).toHaveValue(
      'crosshatched',
    );
    expect(within(dialog).getByLabelText('Background opacity')).toHaveValue(30);
    expect(within(dialog).getByLabelText('Stroke width')).toHaveValue(2);
    expect(within(dialog).getByLabelText('Font size')).toHaveValue(16);
    expect(within(dialog).getByLabelText('Font weight')).toHaveValue('400');

    await user.selectOptions(
      within(dialog).getByLabelText('Background type'),
      'transparent',
    );
    await user.selectOptions(
      within(dialog).getByLabelText('Stroke type'),
      'dotted',
    );
    const strokeWidth = within(dialog).getByLabelText('Stroke width');
    await user.clear(strokeWidth);
    await user.type(strokeWidth, '99{Enter}');
    await user.selectOptions(within(dialog).getByLabelText('Font family'), 'cinzel');

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem(
            `blackboxvtt:shape:${playerSession.campaignId}:player-${playerSession.userId}`,
          ) ?? '{}',
        ),
      ).toMatchObject({
        backgroundType: 'transparent',
        fontFamily: 'cinzel',
        strokeType: 'dotted',
        strokeWidth: 32,
      });
    });
  });

  it('steps the active paint width with brackets without stealing form input', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    fireEvent.keyDown(window, {
      code: 'BracketRight',
      key: ']',
    });
    await user.click(screen.getByRole('button', { name: 'Paint' }));
    fireEvent.keyDown(window, {
      code: 'BracketRight',
      key: ']',
    });
    fireEvent.keyDown(window, {
      code: 'BracketRight',
      key: ']',
      repeat: true,
    });

    const rail = screen.getByRole('toolbar', { name: 'Paint tools' });
    await user.click(
      within(rail).getByRole('button', { name: 'Polyline pen' }),
    );
    fireEvent.keyDown(window, {
      code: 'BracketLeft',
      key: '[',
    });
    fireEvent.keyDown(window, {
      code: 'BracketRight',
      ctrlKey: true,
      key: ']',
    });
    await user.click(
      within(rail).getByRole('button', { name: 'Paint settings' }),
    );

    const freeform = screen.getByRole('region', {
      name: 'Freeform Brush',
    });
    const polyline = screen.getByRole('region', {
      name: 'Polyline Brush',
    });
    expect(within(freeform).getByLabelText('Width')).toHaveValue(25);
    const polylineWidth = within(polyline).getByLabelText('Width');
    expect(polylineWidth).toHaveValue(15);

    fireEvent.keyDown(polylineWidth, {
      code: 'BracketRight',
      key: ']',
    });
    expect(polylineWidth).toHaveValue(15);
  });

  it('shows GM tools and changes the active layer', async () => {
    const user = userEvent.setup();
    const onLayerChange = vi.fn();
    renderPlayScreen({ onLayerChange, session: gmSession });

    expect(screen.getByRole('button', { name: 'Fog' })).toBeInTheDocument();
    expect(
      screen.getByRole('toolbar', { name: 'Map layers' }),
    ).toBeInTheDocument();

    const layerToolbar = screen.getByRole('toolbar', {
      name: 'Map layers',
    });
    expect(
      within(layerToolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['GM layer', 'Token layer', 'Map layer']);
    expect(screen.getByRole('button', { name: 'Token layer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Map layer' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Map layer' }));

    expect(screen.getByRole('button', { name: 'Map layer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Token layer' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(onLayerChange).toHaveBeenCalledWith('map');
  });

  it('exposes the GM fog rail, local preview settings, and whole-map actions', async () => {
    const user = userEvent.setup();
    const currentScene = makeScene();
    const sceneApi = createFakeSceneApi([currentScene]);
    await sceneApi.present({
      campaignId: gmSession.campaignId,
      sceneId: currentScene.id,
    });
    renderPlayScreen({ sceneApi, session: gmSession });

    await user.click(screen.getByRole('button', { name: 'Fog' }));
    const rail = screen.getByRole('toolbar', { name: 'Fog tools' });
    expect(
      within(rail)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Fog settings',
      'Fog mode: Reveal',
      'Box fog',
      'Brush fog',
    ]);
    await user.click(within(rail).getByRole('button', {
      name: 'Fog mode: Reveal',
    }));
    expect(within(rail).getByRole('button', {
      name: 'Fog mode: Hide',
    })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(rail).getByRole('button', { name: 'Box fog' }));
    expect(within(rail).getByRole('button', { name: 'Box fog' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(rail).getByRole('button', { name: 'Fog settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Fog settings' });
    expect(within(dialog).queryAllByRole('heading')).toHaveLength(0);
    expect(within(dialog).getByLabelText('Fog color')).toHaveValue('#000000');
    expect(within(dialog).getByLabelText('GM preview opacity')).toHaveValue(35);
    expect(within(dialog).getByLabelText('Width')).toHaveValue(70);
    expect(within(dialog).getByLabelText('Hardness')).toHaveValue(100);

    const width = within(dialog).getByLabelText('Width');
    await user.clear(width);
    await user.type(width, '88{Enter}');
    const opacity = within(dialog).getByLabelText('GM preview opacity');
    await user.clear(opacity);
    await user.type(opacity, '25{Enter}');
    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem(
            `blackboxvtt:fog:${gmSession.campaignId}:gm`,
          ) ?? '{}',
        ),
      ).toMatchObject({ brushWidth: 88, gmOpacity: 0.25 });
    });

    const coverMap = within(dialog).getByRole('button', { name: 'Cover map' });
    const clearFog = within(dialog).getByRole('button', { name: 'Clear all fog' });
    expect(coverMap.parentElement).toBe(clearFog.parentElement);
    await user.click(coverMap);
    expect(screen.queryByRole('dialog', { name: 'Cover map with fog?' }))
      .not.toBeInTheDocument();
    await waitFor(() => {
      expect(sceneApi.setFog).toHaveBeenCalledWith(expect.objectContaining({
        mutation: { kind: 'cover-all' },
        sceneId: currentScene.id,
      }));
    });

    await user.click(within(rail).getByRole('button', { name: 'Fog settings' }));
    const reopened = screen.getByRole('dialog', { name: 'Fog settings' });
    await user.click(within(reopened).getByRole('button', {
      name: 'Clear all fog',
    }));
    expect(screen.queryByRole('dialog', { name: 'Clear all fog?' }))
      .not.toBeInTheDocument();
    await waitFor(() => {
      expect(sceneApi.setFog).toHaveBeenCalledWith(expect.objectContaining({
        mutation: { kind: 'clear-all' },
        sceneId: currentScene.id,
      }));
    });
  });

  it('switches sidebar tabs with mouse and roving keyboard controls', async () => {
    const user = userEvent.setup();
    const onSidebarTabChange = vi.fn();
    renderPlayScreen({ onSidebarTabChange });

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    expect(chatTab).toHaveAttribute('aria-selected', 'true');

    const scenesTab = screen.getByRole('tab', { name: 'Scenes' });
    await user.click(scenesTab);
    /* Roving is a property of the tab list, so the assertion starts from it
       rather than from wherever the panel behind it left focus. */
    scenesTab.focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowRight}');
    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(onSidebarTabChange).toHaveBeenCalledWith('chat');
  });

  it('opens placeholder panels for tabs without a feature', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    const tabs = ['Scenes', 'Music', 'Settings'] as const;

    for (const label of tabs) {
      await user.click(screen.getByRole('tab', { name: label }));

      const panel = screen.getByRole('tabpanel', { name: label });
      expect(panel).toBeVisible();
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
  });

  it('opens the Journal collection shell for players and Game Masters', async () => {
    const user = userEvent.setup();
    renderPlayScreen();
    await user.click(screen.getByRole('tab', { name: 'Journal' }));

    expect(
      screen.getByRole('searchbox', { name: 'Search journal' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add journal entry' }),
    ).toBeEnabled();

    cleanup();
    renderPlayScreen({ session: gmSession });
    await user.click(screen.getByRole('tab', { name: 'Journal' }));
    expect(
      screen.getByRole('searchbox', { name: 'Search journal' }),
    ).toBeVisible();
  });

  it('renders management settings only for the local GM', async () => {
    const user = userEvent.setup();
    renderPlayScreen({
      serverSettings: createDefaultServerSettings(),
      serverStatus: {
        boundFamilies: ['IPv4'],
        certificateFingerprint: 'AA:BB',
        connectedPlayerCount: 4,
        effectivePort: 30_000,
        localAddresses: ['192.168.1.25'],
        publicAddresses: ['203.0.113.12'],
        state: 'online',
      },
      session: gmSession,
    });

    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(
      screen.getByRole('heading', { name: 'Server Management' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'User Management' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Server Online 4 Players Connected'),
    ).toBeInTheDocument();
  });

  it('keeps a sidebar tab populated across switches without reading it again', async () => {
    const user = userEvent.setup();
    const assetApi = createFakeAssetApi([storedImage]);
    renderPlayScreen({ assetApi, session: gmSession });

    await user.click(screen.getByRole('tab', { name: 'Storage' }));
    expect(await screen.findByRole('button', { name: 'Images' })).toBeVisible();
    expect(vi.mocked(assetApi.list).mock.calls).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    /* Found without waiting, because the library outlived the switch: the tab
       that comes back is already populated rather than empty until it has
       read itself in again. */
    expect(screen.getByRole('button', { name: 'Images' })).toBeVisible();
    expect(vi.mocked(assetApi.list).mock.calls).toHaveLength(1);
  });

  it('opens a preloaded library without waiting to read it', async () => {
    const user = userEvent.setup();
    const assetApi = createFakeAssetApi([]);
    /* Never settles, so everything on screen can only have come from the
       preload rather than from a read this screen performed itself. */
    vi.mocked(assetApi.list).mockImplementation(() => new Promise(() => {}));
    renderPlayScreen({
      assetApi,
      preload: {
        assets: { assets: [storedImage], users: [] },
        chat: null,
        createRenderer: null,
        journal: null,
        journalContent: null,
        preparation: {
          completedItems: 0,
          sceneGraphItems: 0,
          sceneImageItems: 0,
          totalItems: 1,
        },
        previews: new Map(),
        scenes: null,
        thumbnails: new Map(),
      },
      session: gmSession,
    });

    await user.click(screen.getByRole('tab', { name: 'Storage' }));
    expect(screen.getByRole('button', { name: 'Images' })).toBeVisible();
  });

  it('discards transient GM settings drafts after leaving the tab', async () => {
    const user = userEvent.setup();
    renderPlayScreen({
      serverSettings: {
        maxChatMessageCharacters: 10_000,
        port: 30_000,
        users: [
          {
            connected: false,
            hasPassword: true,
            id: 'alice',
            username: 'Alice',
          },
        ],
      },
      session: gmSession,
    });

    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByLabelText('New password for Alice')).toHaveAttribute(
      'type',
      'password',
    );
    await user.clear(screen.getByLabelText('Server port'));
    await user.type(screen.getByLabelText('Server port'), '31000');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('New username'), 'Unsaved');

    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByLabelText('Server port')).toHaveValue(30_000);
    expect(screen.queryByLabelText('New username')).not.toBeInTheDocument();
  });

  it('gives both roles the Scenes tab, and only the GM the controls it owns', async () => {
    const user = userEvent.setup();
    renderPlayScreen({
      sceneApi: createFakeSceneApi([]),
      session: gmSession,
    });

    await user.click(screen.getByRole('tab', { name: 'Scenes' }));

    const gmPanel = screen.getByRole('tabpanel', { name: 'Scenes' });
    expect(
      within(gmPanel).getByRole('searchbox', { name: 'Search scenes' }),
    ).toBeInTheDocument();
    expect(
      within(gmPanel).getByRole('button', { name: 'Add scene' }),
    ).toBeInTheDocument();

    cleanup();
    renderPlayScreen({
      sceneApi: createFakeSceneApi([]),
      session: playerSession,
    });
    await user.click(screen.getByRole('tab', { name: 'Scenes' }));

    /* A player has a library of their own now: what the Game Master granted
       them, which is nothing until they are given something. */
    const playerPanel = screen.getByRole('tabpanel', { name: 'Scenes' });
    expect(playerPanel).toBeVisible();
    expect(
      within(playerPanel).getByRole('searchbox', { name: 'Search scenes' }),
    ).toBeInTheDocument();
  });

  it('dispatches immediate Logout and Exit actions', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const onLogout = vi.fn();
    renderPlayScreen({ onExit, onLogout });

    await user.click(screen.getByRole('button', { name: 'Logout' }));
    await user.click(
      screen.getByRole('button', { name: 'Exit application' }),
    );

    expect(onLogout).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
