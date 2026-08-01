import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_SCHEMA_VERSION,
  type CampaignApi,
  type CampaignSummary,
} from '../../../shared/campaigns';
import type { ApplicationApi } from '../../../shared/application';
import type { AssetApi } from '../../../shared/assets';
import type { NetworkApi, ServerSettingsView } from '../../../shared/network';
import { createMockNetworkApi } from '../../support/networkApi';
import { App } from '../../../app/App';

const createdCampaign: CampaignSummary = {
  createdAt: '2026-07-26T05:00:00.000Z',
  id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  name: 'Iron Meridian',
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  updatedAt: '2026-07-26T05:00:00.000Z',
};

const remoteSession = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  campaignName: 'Remote Campaign',
  host: 'vtt.local',
  port: 43_110,
  role: 'player' as const,
  source: 'remote' as const,
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

const remoteSavedConnection = {
  campaignId: remoteSession.campaignId,
  campaignName: remoteSession.campaignName,
  host: remoteSession.host,
  lastConnectedAt: '2026-07-27T05:00:00.000Z',
  lastUserId: remoteSession.userId,
  port: remoteSession.port,
  profiles: [
    {
      hasSavedPassword: true,
      userId: remoteSession.userId,
      username: remoteSession.username,
    },
  ],
};

function createAuthenticatedNetworkApi(
  overrides: Partial<NetworkApi> = {},
) {
  return createMockNetworkApi({
    connect: vi.fn(async () => ({
      ok: true as const,
      value: {
        state: 'authentication_required' as const,
        challenge: {
          attemptId: '33333333-3333-4333-8333-333333333333',
          campaignId: remoteSession.campaignId,
          campaignName: remoteSession.campaignName,
          users: [
            {
              hasSavedPassword: false,
              id: remoteSession.userId,
              username: remoteSession.username,
            },
          ],
        },
      },
    })),
    authenticate: vi.fn(async () => ({
      ok: true as const,
      value: remoteSession,
    })),
    ...overrides,
  });
}

function createMockAssetApi(
  overrides: Partial<AssetApi> = {},
): AssetApi {
  return {
    getPreview: vi.fn(),
    list: vi.fn(async () => ({ ok: true as const, value: [] })),
    onChanged: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    onProgress: vi.fn(() => () => undefined),
    pickAndImport: vi.fn(),
    prepareRemote: vi.fn(async () => ({ ok: true as const, value: [] })),
    releasePreview: vi.fn(),
    rename: vi.fn(),
    trash: vi.fn(),
    ...overrides,
  };
}

describe('App campaign integration', () => {
  it('loads, creates, lists, and removes persistent campaign summaries', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(async () => ({
        ok: true as const,
        value: createdCampaign,
      })),
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      trash: vi.fn(async () => ({ ok: true as const, value: null })),
    };
    const networkApi = createAuthenticatedNetworkApi();

    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText('Campaign name');
    await user.type(nameInput, 'Iron Meridian');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByRole('heading', { name: 'Created campaigns' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Iron Meridian')).toBeInTheDocument();
    expect(nameInput).toHaveValue('');
    expect(campaignApi.create).toHaveBeenCalledWith({
      name: 'Iron Meridian',
    });

    await user.click(
      screen.getByRole('button', { name: 'Delete Iron Meridian' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm deletion of Iron Meridian',
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Iron Meridian')).not.toBeInTheDocument();
    });
    expect(campaignApi.trash).toHaveBeenCalledWith({
      id: createdCampaign.id,
    });
  });

  it('surfaces a repository loading failure', async () => {
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({
        error: {
          code: 'storage_error' as const,
          message: 'Campaigns could not be loaded.',
        },
        ok: false as const,
      })),
      trash: vi.fn(),
    };

    render(<App campaignApi={campaignApi} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));

    expect(
      await screen.findByText('Campaigns could not be loaded.'),
    ).toHaveAttribute('role', 'alert');
  });

  it('surfaces an unexpected IPC rejection as a storage failure', async () => {
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
      trash: vi.fn(),
    };

    render(<App campaignApi={campaignApi} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));

    expect(
      await screen.findByText('Campaigns could not be loaded.'),
    ).toHaveAttribute('role', 'alert');
  });

  it('reports ready once campaigns resolve so the host window can be shown', async () => {
    const applicationApi: ApplicationApi = {
      openExternal: vi.fn(async () => true),
      quit: vi.fn(),
      ready: vi.fn(),
    };
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({ ok: true as const, value: [createdCampaign] })),
      trash: vi.fn(),
    };

    render(<App applicationApi={applicationApi} campaignApi={campaignApi} />);

    await waitFor(() => {
      expect(applicationApi.ready).toHaveBeenCalled();
    });
  });

  it('reports ready even when campaigns fail to load', async () => {
    // Without this the window would stay hidden on any storage failure, leaving
    // the app running with nothing on screen.
    const applicationApi: ApplicationApi = {
      openExternal: vi.fn(async () => true),
      quit: vi.fn(),
      ready: vi.fn(),
    };
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
      trash: vi.fn(),
    };

    render(<App applicationApi={applicationApi} campaignApi={campaignApi} />);

    await waitFor(() => {
      expect(applicationApi.ready).toHaveBeenCalled();
    });
  });

  it('saves a manual profile and only enters play from its saved Connect action', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      trash: vi.fn(),
    };
    let connectionCount = 0;
    const connect = vi.fn(async () => {
      connectionCount += 1;
      return {
        ok: true as const,
        value: {
          state: 'authentication_required' as const,
          challenge: {
            attemptId: '33333333-3333-4333-8333-333333333333',
            campaignId: remoteSession.campaignId,
            campaignName: remoteSession.campaignName,
            users: [
              {
                hasSavedPassword: connectionCount > 1,
                id: remoteSession.userId,
                username: remoteSession.username,
              },
            ],
          },
        },
      };
    });
    const listHistory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [] })
      .mockResolvedValue({
        ok: true as const,
        value: [remoteSavedConnection],
      });
    const networkApi = createAuthenticatedNetworkApi({
      connect,
      listHistory,
    });

    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    await user.type(
      screen.getByLabelText('IP address or host'),
      '  vtt.local  ',
    );
    await user.type(screen.getByLabelText('Port'), '43110');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(
      screen.getByRole('button', { name: 'Save Credentials' }),
    );

    expect(
      screen.queryByRole('region', { name: /Map play area/ }),
    ).not.toBeInTheDocument();
    const savedRow = (await screen.findByText('Remote Campaign')).closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Remote campaign at vtt.local:43110 — Player',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Map play area for vtt.local:43110',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect' }),
    ).not.toBeInTheDocument();
    expect(networkApi.authenticate).toHaveBeenCalledWith({
      attemptId: '33333333-3333-4333-8333-333333333333',
      password: 'password',
      useSavedPassword: false,
      userId: remoteSession.userId,
    });
    expect(networkApi.authenticate).toHaveBeenLastCalledWith({
      attemptId: '33333333-3333-4333-8333-333333333333',
      password: undefined,
      useSavedPassword: true,
      userId: remoteSession.userId,
    });
    expect(networkApi.disconnect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenLastCalledWith({
      expectedCampaignId: remoteSession.campaignId,
      host: remoteSession.host,
      port: remoteSession.port,
    });
  });

  it('does not enter play with an invalid endpoint', () => {
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      trash: vi.fn(),
    };

    const networkApi = createMockNetworkApi();
    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    const form = screen.getByRole('button', { name: 'Connect' }).closest('form');

    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(
      screen.queryByRole('region', { name: /Map play area/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('gates saved-campaign play on asset synchronization and reports failure', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      trash: vi.fn(),
    };
    const networkApi = createAuthenticatedNetworkApi({
      connect: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: 'authentication_required' as const,
          challenge: {
            attemptId: '33333333-3333-4333-8333-333333333333',
            campaignId: remoteSession.campaignId,
            campaignName: remoteSession.campaignName,
            users: [
              {
                hasSavedPassword: true,
                id: remoteSession.userId,
                username: remoteSession.username,
              },
            ],
          },
        },
      })),
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [remoteSavedConnection],
      })),
    });
    let resolveSync:
      | ((value: Awaited<ReturnType<AssetApi['prepareRemote']>>) => void)
      | undefined;
    const prepareRemote = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<AssetApi['prepareRemote']>>>(
          (resolve) => {
            resolveSync = resolve;
          },
        ),
    );
    const assetApi = createMockAssetApi({ prepareRemote });
    render(
      <App
        assetApi={assetApi}
        campaignApi={campaignApi}
        networkApi={networkApi}
      />,
    );
    const savedRow = (await screen.findByText('Remote Campaign')).closest('li')!;
    await user.click(within(savedRow).getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(prepareRemote).toHaveBeenCalledWith({
        campaignId: remoteSession.campaignId,
      }),
    );
    expect(
      screen.queryByRole('region', { name: /Map play area/ }),
    ).not.toBeInTheDocument();

    resolveSync?.({
      error: {
        code: 'sync_error',
        message: 'Map.png failed integrity verification.',
      },
      ok: false,
    });
    expect(
      await screen.findByRole('dialog', {
        name: 'Campaign asset synchronization failed',
      }),
    ).toHaveTextContent('Map.png failed integrity verification.');
    expect(
      screen.queryByRole('region', { name: /Map play area/ }),
    ).not.toBeInTheDocument();
  });

  it('opens a local campaign as GM and preserves connection state on Logout', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({
        ok: true as const,
        value: [createdCampaign],
      })),
      trash: vi.fn(),
    };

    const networkApi = createMockNetworkApi();
    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    const campaignName = screen.getByLabelText('Campaign name');
    await user.type(campaignName, 'Unpublished draft');

    await user.click(
      await screen.findByRole('button', { name: 'Open Iron Meridian' }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Iron Meridian — Game Master',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fog' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(
      screen.getByRole('tab', { name: 'Create Campaign' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Unpublished draft',
    );
    expect(screen.getByText('Iron Meridian')).toBeInTheDocument();
    expect(campaignApi.list).toHaveBeenCalledTimes(2);
    expect(networkApi.openHost).toHaveBeenCalledWith({
      campaignId: createdCampaign.id,
    });
    expect(networkApi.stopHost).toHaveBeenCalledOnce();
  });

  it('enters local play only after the campaign host is ready', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({
        ok: true as const,
        value: [createdCampaign],
      })),
      trash: vi.fn(),
    };
    let resolveHost:
      | ((value: Awaited<ReturnType<NetworkApi['openHost']>>) => void)
      | undefined;
    const openHost = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<NetworkApi['openHost']>>>((resolve) => {
          resolveHost = resolve;
        }),
    );
    const networkApi = createMockNetworkApi({ openHost });

    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    await user.click(
      await screen.findByRole('button', { name: 'Open Iron Meridian' }),
    );

    expect(
      screen.queryByRole('heading', {
        name: /Iron Meridian.*Game Master/,
      }),
    ).not.toBeInTheDocument();

    resolveHost?.({
      ok: true,
      value: {
        boundFamilies: ['IPv4'],
        certificateFingerprint: 'fingerprint',
        connectedPlayerCount: 0,
        effectivePort: 30_000,
        localAddresses: ['127.0.0.1'],
        publicAddresses: [],
        state: 'online',
      },
    });

    expect(
      await screen.findByRole('heading', {
        name: /Iron Meridian.*Game Master/,
      }),
    ).toBeInTheDocument();
  });

  it('persists server settings through the main-process API across Logout', async () => {
    const user = userEvent.setup();
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({
        ok: true as const,
        value: [createdCampaign],
      })),
      trash: vi.fn(),
    };
    let settings: ServerSettingsView = {
      maxChatMessageCharacters: 10_000,
      port: 30_000,
      users: [],
    };
    const networkApi = createMockNetworkApi({
      createUser: vi.fn(async (input) => {
        const user = {
          connected: false,
          hasPassword: true,
          id: '44444444-4444-4444-8444-444444444444',
          username: input.username,
        };
        settings = { ...settings, users: [...settings.users, user] };
        return { ok: true as const, value: user };
      }),
      getServerSettings: vi.fn(async () => ({
        ok: true as const,
        value: settings,
      })),
      setPort: vi.fn(async (input) => {
        settings = { ...settings, port: input.port };
        return { ok: true as const, value: input.port };
      }),
    });

    render(<App campaignApi={campaignApi} networkApi={networkApi} />);
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    await user.click(
      await screen.findByRole('button', { name: 'Open Iron Meridian' }),
    );
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const port = screen.getByLabelText('Server port');
    await user.clear(port);
    await user.type(port, '31000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    await user.type(screen.getByLabelText('New username'), 'Alice');
    await user.type(
      screen.getByLabelText('New password'),
      'password',
    );
    const userManagement = screen.getByRole('region', {
      name: 'User Management',
    });
    await user.click(
      within(userManagement).getByRole('button', { name: 'Save' }),
    );

    await user.click(screen.getByRole('button', { name: 'Logout' }));
    await user.click(
      screen.getByRole('button', { name: 'Open Iron Meridian' }),
    );
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByLabelText('Server port')).toHaveValue(31_000);
    expect(screen.getByLabelText('Username for Alice')).toHaveValue('Alice');
    expect(screen.getByLabelText('New password for Alice')).toHaveValue('');
    expect(screen.getByLabelText('New password for Alice')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('sends an immediate application quit request from play', async () => {
    const user = userEvent.setup();
    const applicationApi: ApplicationApi = {
      openExternal: vi.fn(async () => true),
      quit: vi.fn(),
      ready: vi.fn(),
    };
    const campaignApi: CampaignApi = {
      create: vi.fn(),
      list: vi.fn(async () => ({
        ok: true as const,
        value: [createdCampaign],
      })),
      trash: vi.fn(),
    };
    const networkApi = createMockNetworkApi();

    render(
      <App
        applicationApi={applicationApi}
        campaignApi={campaignApi}
        networkApi={networkApi}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    await user.click(
      await screen.findByRole('button', { name: 'Open Iron Meridian' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Exit application' }),
    );

    expect(applicationApi.quit).toHaveBeenCalledOnce();
  });
});
