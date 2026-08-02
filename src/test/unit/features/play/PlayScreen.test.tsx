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

const playerSession: PlayScreenProps['session'] = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  campaignName: 'Remote Campaign',
  host: 'vtt.local',
  port: 43_110,
  role: 'player',
  source: 'remote',
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

const gmSession: PlayScreenProps['session'] = {
  campaignId: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  campaignName: 'Iron Meridian',
  role: 'gm',
  source: 'local',
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

  it('changes tools and dispatches every fixture quick action', async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn();
    const onToolChange = vi.fn();
    renderPlayScreen({ onQuickAction, onToolChange });

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

    const actions = [
      ['Roll Dice', 'roll-dice'],
      ['Initiative', 'initiative'],
      ['End Turn', 'end-turn'],
      ['Ping Map', 'ping-map'],
      ['Center View', 'center-view'],
      ['Notes', 'notes'],
    ] as const;

    const actionToolbar = screen.getByRole('toolbar', {
      name: 'Quick actions',
    });

    for (const [label] of actions) {
      const button = within(actionToolbar).getByRole('button', { name: label });
      expect(button).toHaveTextContent(label);
      await user.click(button);
    }

    expect(onQuickAction.mock.calls.map(([id]) => id)).toEqual(
      actions.map(([, id]) => id),
    );
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

  it('switches sidebar tabs with mouse and roving keyboard controls', async () => {
    const user = userEvent.setup();
    const onSidebarTabChange = vi.fn();
    renderPlayScreen({ onSidebarTabChange });

    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    expect(chatTab).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Scenes' }));

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowRight}');
    expect(chatTab).toHaveAttribute('aria-selected', 'true');
    expect(onSidebarTabChange).toHaveBeenCalledWith('chat');
  });

  it('renders icon-only placeholders for tabs without a feature', async () => {
    const user = userEvent.setup();
    renderPlayScreen();

    const tabs = [
      ['Scenes', 'scenes'],
      ['Journal', 'journal'],
      ['Music', 'music'],
      ['Settings', 'settings'],
    ] as const;

    for (const [label, id] of tabs) {
      await user.click(screen.getByRole('tab', { name: label }));

      const panel = screen.getByRole('tabpanel', { name: label });
      const icon = panel.querySelector(`[data-sidebar-icon="${id}"] svg`);

      expect(icon).toHaveAttribute('width', '5rem');
      expect(icon).toHaveAttribute('height', '5rem');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(panel.querySelector('h2')).not.toBeInTheDocument();
      expect(panel.querySelector('p')).not.toBeInTheDocument();
    }
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
    expect(
      screen
        .getByRole('tabpanel', { name: 'Settings' })
        .querySelector('[data-sidebar-icon="settings"]'),
    ).not.toBeInTheDocument();
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

  it('gives the GM scene management and leaves players the placeholder', async () => {
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

    const playerPanel = screen.getByRole('tabpanel', { name: 'Scenes' });
    expect(
      within(playerPanel).queryByRole('searchbox'),
    ).not.toBeInTheDocument();
    expect(
      playerPanel.querySelector('[data-sidebar-icon="scenes"]'),
    ).toBeInTheDocument();
  });

  it('centers the view on the presented scene from the quick action', async () => {
    const user = userEvent.setup();
    const scene = makeScene();
    const sceneApi = createFakeSceneApi([scene]);
    await sceneApi.present({
      campaignId: gmSession.campaignId,
      sceneId: scene.id,
    });
    const onQuickAction = vi.fn();
    renderPlayScreen({ onQuickAction, sceneApi, session: gmSession });

    await waitFor(() => {
      expect(
        screen.getByText('Viewing the scene Iron Keep.'),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Center View' }));

    expect(onQuickAction).toHaveBeenCalledWith('center-view');
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
