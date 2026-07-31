import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_SCHEMA_VERSION,
  type CampaignSummary,
} from '../../../../shared/campaigns';
import type {
  SavedConnection,
  TrustChallenge,
} from '../../../../shared/network';
import { createMockNetworkApi } from '../../../support/networkApi';
import {
  ConnectionScreen,
  DELETE_CONFIRMATION_TIMEOUT_MS,
} from '../../../../features/connection/ConnectionScreen';
import type { ConnectionScreenProps } from '../../../../features/connection/types';

const shatteredCoast: CampaignSummary = {
  createdAt: '2026-07-25T18:00:00.000Z',
  id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  name: 'Shattered Coast',
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  updatedAt: '2026-07-26T05:00:00.000Z',
};

const emberfall: CampaignSummary = {
  createdAt: '2026-07-24T18:00:00.000Z',
  id: '53b6d9e1-26ec-4fb6-bc89-6d7138160788',
  name: 'Emberfall',
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  updatedAt: '2026-07-25T05:00:00.000Z',
};

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value });
}

const trustAttemptId = '11111111-1111-4111-8111-111111111111';
const trustedCampaignId = '22222222-2222-4222-8222-222222222222';

const savedConnection: SavedConnection = {
  campaignId: '44444444-4444-4444-8444-444444444444',
  campaignName: 'Saved Campaign',
  host: 'saved.local',
  lastConnectedAt: '2026-07-26T05:00:00.000Z',
  lastUserId: '66666666-6666-4666-8666-666666666666',
  port: 30_000,
  profiles: [],
};

const secondSavedConnection: SavedConnection = {
  ...savedConnection,
  campaignId: '55555555-5555-4555-8555-555555555555',
  campaignName: 'Second Campaign',
  host: 'second.local',
};

function trustRequiredConnect(
  challenge: Partial<TrustChallenge> = {},
) {
  return vi.fn(async () => ({
    ok: true as const,
    value: {
      state: 'trust_required' as const,
      challenge: {
        attemptId: trustAttemptId,
        campaignId: trustedCampaignId,
        campaignName: 'Remote Campaign',
        kind: 'first_use' as const,
        newFingerprint: 'AA:BB:CC',
        oldFingerprint: null,
        ...challenge,
      },
    },
  }));
}

function renderConnectionScreen(
  overrides: Partial<ConnectionScreenProps> = {},
) {
  const props: ConnectionScreenProps = {
    campaignLoadError: null,
    campaignLoadState: 'ready',
    campaigns: [shatteredCoast, emberfall],
    networkApi: createMockNetworkApi(),
    onCreate: vi.fn(async () => ({
      ok: true as const,
      value: shatteredCoast,
    })),
    onDeleteCampaign: vi.fn(async () => ({
      ok: true as const,
      value: null,
    })),
    onOpenCampaign: vi.fn(),
    onRemoteAuthenticated: vi.fn(),
    ...overrides,
  };

  render(<ConnectionScreen {...props} />);

  return props;
}

describe('ConnectionScreen', () => {
  it('renders only the bare Join controls', () => {
    renderConnectionScreen();

    expect(
      screen.getByRole('tab', { name: 'Join Campaign' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('IP address or host')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /connections/i }),
    ).not.toBeInTheDocument();
  });

  it('switches tabs with mouse and keyboard controls', async () => {
    const user = userEvent.setup();
    renderConnectionScreen({ campaigns: [] });

    const createTab = screen.getByRole('tab', { name: 'Create Campaign' });
    await user.click(createTab);

    expect(createTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Created campaigns' }),
    ).not.toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');

    expect(
      screen.getByRole('tab', { name: 'Join Campaign' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('submits only host and port through the Join contract', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi();
    renderConnectionScreen({ networkApi });

    await user.type(screen.getByLabelText('IP address or host'), 'vtt.local');
    await user.type(screen.getByLabelText('Port'), '43110');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(networkApi.connect).toHaveBeenCalledWith({
      host: 'vtt.local',
      port: 43_110,
    });
  });

  it('saves first-use credentials without replacing the endpoint form or entering play', async () => {
    const user = userEvent.setup();
    const attemptId = '11111111-1111-4111-8111-111111111111';
    const remoteCampaignId = '22222222-2222-4222-8222-222222222222';
    const remoteUserId = '33333333-3333-4333-8333-333333333333';
    const savedAfterAuthentication: SavedConnection = {
      campaignId: remoteCampaignId,
      campaignName: 'Remote Campaign',
      host: 'vtt.local',
      lastConnectedAt: '2026-07-27T05:00:00.000Z',
      lastUserId: remoteUserId,
      port: 30_000,
      profiles: [
        {
          hasSavedPassword: true,
          userId: remoteUserId,
          username: 'Alice',
        },
      ],
    };
    const listHistory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [] })
      .mockResolvedValue({
        ok: true as const,
        value: [savedAfterAuthentication],
      });
    const networkApi = createMockNetworkApi({
      listHistory,
      connect: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: 'trust_required' as const,
          challenge: {
            attemptId,
            campaignId: remoteCampaignId,
            campaignName: 'Remote Campaign',
            kind: 'first_use' as const,
            newFingerprint: 'AA:BB:CC',
            oldFingerprint: null,
          },
        },
      })),
      acceptTrust: vi.fn(async () => ({
        ok: true as const,
        value: {
          attemptId,
          campaignId: remoteCampaignId,
          campaignName: 'Remote Campaign',
          users: [
            {
              hasSavedPassword: false,
              id: remoteUserId,
              username: 'Alice',
            },
          ],
        },
      })),
      authenticate: vi.fn(async () => ({
        ok: true as const,
        value: {
          campaignId: remoteCampaignId,
          campaignName: 'Remote Campaign',
          host: 'vtt.local',
          port: 30_000,
          role: 'player' as const,
          source: 'remote' as const,
          userId: remoteUserId,
          username: 'Alice',
        },
      })),
    });
    const onRemoteAuthenticated = vi.fn();
    renderConnectionScreen({ networkApi, onRemoteAuthenticated });

    await user.type(screen.getByLabelText('IP address or host'), 'vtt.local');
    await user.type(screen.getByLabelText('Port'), '30000');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    const trustDialog = await screen.findByRole('dialog', {
      name: 'Trust this campaign',
    });
    expect(
      within(trustDialog).queryByRole('heading'),
    ).not.toBeInTheDocument();
    expect(
      within(trustDialog).getByText(
        'Remote Campaign Presented Fingerprint',
      ),
    ).toBeInTheDocument();
    expect(within(trustDialog).getByText('AA:BB:CC')).toBeInTheDocument();
    expect(screen.getByLabelText('IP address or host')).toBeInTheDocument();

    await user.click(
      within(trustDialog).getByRole('button', { name: 'Trust' }),
    );
    expect(await screen.findByLabelText('Username')).toHaveValue(remoteUserId);
    expect(screen.getByLabelText('IP address or host')).toBeDisabled();
    expect(screen.getByLabelText('Port')).toBeDisabled();
    const passwordInput = screen.getByLabelText('Password');
    const authenticateButton = screen.getByRole('button', {
      name: 'Save Credentials',
    });
    const authenticationRow = passwordInput.parentElement?.parentElement;
    expect(authenticationRow?.className).toContain(
      'authenticationFields',
    );
    expect(authenticationRow).toContainElement(authenticateButton);
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    await user.type(passwordInput, 'password');
    await user.click(
      authenticateButton,
    );

    await waitFor(() => {
      expect(networkApi.authenticate).toHaveBeenCalledWith({
        attemptId,
        password: 'password',
        useSavedPassword: false,
        userId: remoteUserId,
      });
    });
    expect(networkApi.disconnect).toHaveBeenCalledOnce();
    expect(onRemoteAuthenticated).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.getByLabelText('IP address or host')).toBeEnabled();
    expect(
      await screen.findByText('Remote Campaign'),
    ).toBeInTheDocument();
    expect(listHistory).toHaveBeenCalledTimes(2);
  });

  it('keeps the modal actions in one complete two-button action row', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi({
      connect: trustRequiredConnect(),
    });
    renderConnectionScreen({ networkApi });

    await user.type(screen.getByLabelText('IP address or host'), 'vtt.local');
    await user.type(screen.getByLabelText('Port'), '30000');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Trust this campaign',
    });
    const buttons = within(dialog).getAllByRole('button');

    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Cancel',
      'Trust',
    ]);
    expect(dialog.querySelector('header')).toBeNull();
    expect(dialog.querySelector('footer')).toBeNull();
    expect(buttons[0].parentElement).toBe(buttons[1].parentElement);
    expect(
      buttons[0].parentElement?.className,
    ).toContain('modalActions');
  });

  it('shows changed campaign identities with both labelled fingerprints', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi({
      connect: trustRequiredConnect({
        kind: 'changed',
        newFingerprint: 'DD:EE:FF',
        oldFingerprint: 'AA:BB:CC',
      }),
    });
    renderConnectionScreen({ networkApi });

    await user.type(screen.getByLabelText('IP address or host'), 'vtt.local');
    await user.type(screen.getByLabelText('Port'), '30000');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Campaign identity changed',
    });
    expect(
      within(dialog).getByText(
        'Remote Campaign Previously Trusted Fingerprint',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Remote Campaign Presented Fingerprint',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('AA:BB:CC')).toBeInTheDocument();
    expect(within(dialog).getByText('DD:EE:FF')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Replace Trust' }),
    ).toBeInTheDocument();
  });

  it.each(['button', 'backdrop', 'escape'] as const)(
    'cancels a pending trust attempt from the %s',
    async (dismissal) => {
      const user = userEvent.setup();
      const cancelConnection = vi.fn(async () => undefined);
      const networkApi = createMockNetworkApi({
        cancelConnection,
        connect: trustRequiredConnect(),
      });
      renderConnectionScreen({ networkApi });

      await user.type(
        screen.getByLabelText('IP address or host'),
        'vtt.local',
      );
      await user.type(screen.getByLabelText('Port'), '30000');
      await user.click(screen.getByRole('button', { name: 'Connect' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Trust this campaign',
      });

      if (dismissal === 'button') {
        await user.click(
          within(dialog).getByRole('button', { name: 'Cancel' }),
        );
      } else if (dismissal === 'backdrop') {
        fireEvent.click(dialog);
      } else {
        fireEvent(
          dialog,
          new Event('cancel', { bubbles: false, cancelable: true }),
        );
      }

      await waitFor(() => {
        expect(cancelConnection).toHaveBeenCalledWith({
          attemptId: trustAttemptId,
        });
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Trust this campaign' }),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    },
  );

  it('keeps the trust modal open when accepting trust fails', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi({
      acceptTrust: vi.fn(async () => ({
        error: {
          code: 'storage_error' as const,
          message: 'Campaign trust could not be saved.',
        },
        ok: false as const,
      })),
      connect: trustRequiredConnect(),
    });
    renderConnectionScreen({ networkApi });

    await user.type(screen.getByLabelText('IP address or host'), 'vtt.local');
    await user.type(screen.getByLabelText('Port'), '30000');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Trust this campaign',
    });

    await user.click(
      within(dialog).getByRole('button', { name: 'Trust' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Campaign trust could not be saved.',
    );
    expect(dialog).toHaveAttribute('open');
    expect(
      within(dialog).getByRole('button', { name: 'Trust' }),
    ).toBeEnabled();
  });

  it('automatically enters a saved campaign with its last saved profile', async () => {
    const user = userEvent.setup();
    const campaignId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const historyEntry: SavedConnection = {
      campaignId,
      campaignName: 'Saved Campaign',
      host: 'saved.local',
      lastConnectedAt: '2026-07-26T05:00:00.000Z',
      lastUserId: userId,
      port: 30_000,
      profiles: [
        { hasSavedPassword: true, userId, username: 'Alice' },
      ],
    };
    const networkApi = createMockNetworkApi({
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [historyEntry],
      })),
      connect: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: 'authentication_required' as const,
          challenge: {
            attemptId,
            campaignId,
            campaignName: 'Saved Campaign',
            users: [
              { hasSavedPassword: true, id: userId, username: 'Alice' },
            ],
          },
        },
      })),
      authenticate: vi.fn(async () => ({
        ok: true as const,
        value: {
          campaignId,
          campaignName: 'Saved Campaign',
          host: 'saved.local',
          port: 30_000,
          role: 'player' as const,
          source: 'remote' as const,
          userId,
          username: 'Alice',
        },
      })),
    });
    const onRemoteAuthenticated = vi.fn();
    renderConnectionScreen({ networkApi, onRemoteAuthenticated });

    await screen.findByRole('heading', { name: 'Saved campaigns' });
    const savedRow = screen.getByText('Saved Campaign').closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    await waitFor(() => {
      expect(networkApi.authenticate).toHaveBeenCalledWith({
        attemptId,
        password: undefined,
        useSavedPassword: true,
        userId,
      });
    });
    expect(networkApi.connect).toHaveBeenCalledWith({
      expectedCampaignId: campaignId,
      host: 'saved.local',
      port: 30_000,
    });
    expect(onRemoteAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId }),
    );
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('continues saved auto-login after replacing changed trust', async () => {
    const user = userEvent.setup();
    const userId = savedConnection.lastUserId;
    const entry: SavedConnection = {
      ...savedConnection,
      profiles: [
        { hasSavedPassword: true, userId, username: 'Alice' },
      ],
    };
    const authenticate = vi.fn(async () => ({
      ok: true as const,
      value: {
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        host: entry.host,
        port: entry.port,
        role: 'player' as const,
        source: 'remote' as const,
        userId,
        username: 'Alice',
      },
    }));
    const networkApi = createMockNetworkApi({
      acceptTrust: vi.fn(async () => ({
        ok: true as const,
        value: {
          attemptId: trustAttemptId,
          campaignId: entry.campaignId,
          campaignName: entry.campaignName,
          users: [
            { hasSavedPassword: true, id: userId, username: 'Alice' },
          ],
        },
      })),
      authenticate,
      connect: trustRequiredConnect({
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        kind: 'changed',
        oldFingerprint: 'AA:BB:CC',
        newFingerprint: 'DD:EE:FF',
      }),
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [entry],
      })),
    });
    const onRemoteAuthenticated = vi.fn();
    renderConnectionScreen({ networkApi, onRemoteAuthenticated });

    const savedRow = (await screen.findByText('Saved Campaign')).closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Campaign identity changed',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Replace Trust' }),
    );

    await waitFor(() => {
      expect(authenticate).toHaveBeenCalledWith({
        attemptId: trustAttemptId,
        password: undefined,
        useSavedPassword: true,
        userId,
      });
    });
    expect(onRemoteAuthenticated).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it('removes a saved campaign when automatic credential authentication fails', async () => {
    const user = userEvent.setup();
    const userId = savedConnection.lastUserId;
    const entry: SavedConnection = {
      ...savedConnection,
      profiles: [
        { hasSavedPassword: true, userId, username: 'Alice' },
      ],
    };
    const cancelConnection = vi.fn(async () => undefined);
    const deleteHistory = vi.fn(async () => ({
      ok: true as const,
      value: null,
    }));
    const networkApi = createMockNetworkApi({
      authenticate: vi.fn(async () => ({
        error: {
          code: 'authentication_failed' as const,
          message: 'Stored password is stale.',
        },
        ok: false as const,
      })),
      cancelConnection,
      connect: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: 'authentication_required' as const,
          challenge: {
            attemptId: trustAttemptId,
            campaignId: entry.campaignId,
            campaignName: entry.campaignName,
            users: [
              { hasSavedPassword: true, id: userId, username: 'Alice' },
            ],
          },
        },
      })),
      deleteHistory,
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [entry],
      })),
    });
    renderConnectionScreen({ networkApi });

    const savedRow = (await screen.findByText('Saved Campaign')).closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    await waitFor(() => {
      expect(deleteHistory).toHaveBeenCalledWith({
        campaignId: entry.campaignId,
      });
    });
    expect(cancelConnection).toHaveBeenCalledWith({
      attemptId: trustAttemptId,
    });
    expect(screen.queryByText('Saved Campaign')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stored password is stale.',
    );
  });

  it('retains a saved campaign when automatic cleanup fails', async () => {
    const user = userEvent.setup();
    const userId = savedConnection.lastUserId;
    const entry: SavedConnection = {
      ...savedConnection,
      profiles: [
        { hasSavedPassword: true, userId, username: 'Alice' },
      ],
    };
    const deleteHistory = vi.fn(async () => ({
      error: {
        code: 'storage_error' as const,
        message: 'Saved campaign could not be deleted.',
      },
      ok: false as const,
    }));
    const networkApi = createMockNetworkApi({
      authenticate: vi.fn(async () => ({
        error: {
          code: 'authentication_failed' as const,
          message: 'Stored password is stale.',
        },
        ok: false as const,
      })),
      connect: vi.fn(async () => ({
        ok: true as const,
        value: {
          state: 'authentication_required' as const,
          challenge: {
            attemptId: trustAttemptId,
            campaignId: entry.campaignId,
            campaignName: entry.campaignName,
            users: [
              { hasSavedPassword: true, id: userId, username: 'Alice' },
            ],
          },
        },
      })),
      deleteHistory,
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [entry],
      })),
    });
    renderConnectionScreen({ networkApi });

    const savedRow = (await screen.findByText('Saved Campaign')).closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stored password is stale. Saved campaign could not be deleted.',
    );
    expect(screen.getByText('Saved Campaign')).toBeInTheDocument();
  });

  it('retains saved history after a transient connection failure', async () => {
    const user = userEvent.setup();
    const deleteHistory = vi.fn();
    const networkApi = createMockNetworkApi({
      connect: vi.fn(async () => ({
        error: {
          code: 'server_unavailable' as const,
          message: 'Campaign server is offline.',
        },
        ok: false as const,
      })),
      deleteHistory,
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [savedConnection],
      })),
    });
    renderConnectionScreen({ networkApi });

    const savedRow = (await screen.findByText('Saved Campaign')).closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Campaign server is offline.',
    );
    expect(screen.getByText('Saved Campaign')).toBeInTheDocument();
    expect(deleteHistory).not.toHaveBeenCalled();
  });

  it('requires two activations before deleting saved connection history', async () => {
    const user = userEvent.setup();
    const deleteHistory = vi.fn(async () => ({
      ok: true as const,
      value: null,
    }));
    const networkApi = createMockNetworkApi({
      deleteHistory,
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [savedConnection],
      })),
    });
    renderConnectionScreen({ networkApi });

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete Saved Campaign',
    });
    await user.click(deleteButton);

    expect(deleteHistory).not.toHaveBeenCalled();
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm deletion of Saved Campaign',
    });
    expect(confirmButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(confirmButton);
    await waitFor(() => {
      expect(deleteHistory).toHaveBeenCalledWith({
        campaignId: savedConnection.campaignId,
      });
    });
    expect(screen.queryByText('Saved Campaign')).not.toBeInTheDocument();
  });

  it('moves and expires saved connection delete confirmation', async () => {
    const networkApi = createMockNetworkApi({
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [savedConnection, secondSavedConnection],
      })),
    });
    renderConnectionScreen({ networkApi });
    await screen.findByRole('button', {
      name: 'Delete Saved Campaign',
    });

    vi.useFakeTimers();
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete Saved Campaign' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete Second Campaign' }),
      );

      expect(
        screen.getByRole('button', { name: 'Delete Saved Campaign' }),
      ).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.getByRole('button', {
          name: 'Confirm deletion of Second Campaign',
        }),
      ).toHaveAttribute('aria-pressed', 'true');

      act(() => {
        vi.advanceTimersByTime(DELETE_CONFIRMATION_TIMEOUT_MS);
      });

      expect(
        screen.getByRole('button', { name: 'Delete Second Campaign' }),
      ).toHaveAttribute('aria-pressed', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets saved connection delete confirmation when connecting', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi({
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [savedConnection],
      })),
    });
    renderConnectionScreen({ networkApi });
    const deleteButton = await screen.findByRole('button', {
      name: 'Delete Saved Campaign',
    });

    await user.click(deleteButton);
    const savedRow = screen.getByText('Saved Campaign').closest('li');
    expect(savedRow).not.toBeNull();
    await user.click(
      within(savedRow as HTMLLIElement).getByRole('button', {
        name: 'Connect',
      }),
    );

    expect(
      screen.getByRole('button', { name: 'Delete Saved Campaign' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps saved history after a deletion failure', async () => {
    const user = userEvent.setup();
    const networkApi = createMockNetworkApi({
      deleteHistory: vi.fn(async () => ({
        error: {
          code: 'storage_error' as const,
          message: 'Saved campaign could not be deleted.',
        },
        ok: false as const,
      })),
      listHistory: vi.fn(async () => ({
        ok: true as const,
        value: [savedConnection],
      })),
    });
    renderConnectionScreen({ networkApi });

    await user.click(
      await screen.findByRole('button', {
        name: 'Delete Saved Campaign',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm deletion of Saved Campaign',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved campaign could not be deleted.',
    );
    expect(screen.getByText('Saved Campaign')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Saved Campaign' }),
    ).toBeEnabled();
  });

  it('clears the campaign name only after successful creation', async () => {
    const user = userEvent.setup();
    let resolveCreate:
      | ((result: Awaited<ReturnType<ConnectionScreenProps['onCreate']>>) => void)
      | undefined;
    const onCreate = vi.fn(
      () =>
        new Promise<
          Awaited<ReturnType<ConnectionScreenProps['onCreate']>>
        >((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderConnectionScreen({ campaigns: [], onCreate });

    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    const nameInput = screen.getByLabelText('Campaign name');
    await user.type(nameInput, 'Iron Meridian');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(nameInput).toHaveValue('Iron Meridian');
    expect(
      screen.getByRole('button', { name: 'Creating…' }),
    ).toBeDisabled();

    resolveCreate?.({ ok: true, value: shatteredCoast });

    await waitFor(() => {
      expect(nameInput).toHaveValue('');
    });
  });

  it('retains the campaign name and reports a creation failure', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({
      error: {
        code: 'duplicate_name' as const,
        message: 'A campaign named “Iron Meridian” already exists.',
      },
      ok: false as const,
    }));
    renderConnectionScreen({ campaigns: [], onCreate });

    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    const nameInput = screen.getByLabelText('Campaign name');
    await user.type(nameInput, 'Iron Meridian');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A campaign named “Iron Meridian” already exists.',
    );
    expect(nameInput).toHaveValue('Iron Meridian');
  });

  it('shows created campaigns and reports Open actions by ID', async () => {
    const user = userEvent.setup();
    const onOpenCampaign = vi.fn();
    renderConnectionScreen({ onOpenCampaign });

    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));

    expect(
      screen.getByRole('heading', { name: 'Created campaigns' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Updated /)).toHaveLength(2);

    await user.click(
      screen.getByRole('button', { name: 'Open Shattered Coast' }),
    );
    expect(onOpenCampaign).toHaveBeenCalledWith(shatteredCoast.id);
  });

  it('requires two activations before deleting a campaign', async () => {
    const user = userEvent.setup();
    const onDeleteCampaign = vi.fn(() => success(null));
    renderConnectionScreen({ onDeleteCampaign });

    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    await user.click(
      screen.getByRole('button', { name: 'Delete Shattered Coast' }),
    );
    expect(onDeleteCampaign).not.toHaveBeenCalled();

    const confirmButton = screen.getByRole('button', {
      name: 'Confirm deletion of Shattered Coast',
    });
    expect(confirmButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(confirmButton);
    await waitFor(() => {
      expect(onDeleteCampaign).toHaveBeenCalledWith(shatteredCoast.id);
    });
  });

  it('returns an armed delete action to its default state after timeout', () => {
    vi.useFakeTimers();

    try {
      renderConnectionScreen();
      fireEvent.click(screen.getByRole('tab', { name: 'Create Campaign' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete Shattered Coast' }),
      );

      act(() => {
        vi.advanceTimersByTime(DELETE_CONFIRMATION_TIMEOUT_MS);
      });

      expect(
        screen.getByRole('button', { name: 'Delete Shattered Coast' }),
      ).toHaveAttribute('aria-pressed', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves confirmation to another row and cancels it on tab change', () => {
    renderConnectionScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Shattered Coast' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Emberfall' }));

    expect(
      screen.getByRole('button', { name: 'Delete Shattered Coast' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', {
        name: 'Confirm deletion of Emberfall',
      }),
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Join Campaign' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Create Campaign' }));

    expect(
      screen.getByRole('button', { name: 'Delete Emberfall' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows compact campaign loading and repository errors', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConnectionScreen
        campaignLoadError={null}
        campaignLoadState="loading"
        campaigns={[]}
        networkApi={createMockNetworkApi()}
        onCreate={vi.fn()}
        onDeleteCampaign={vi.fn()}
        onOpenCampaign={vi.fn()}
        onRemoteAuthenticated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Create Campaign' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading campaigns…',
    );

    rerender(
      <ConnectionScreen
        campaignLoadError="Campaigns could not be loaded."
        campaignLoadState="error"
        campaigns={[]}
        networkApi={createMockNetworkApi()}
        onCreate={vi.fn()}
        onDeleteCampaign={vi.fn()}
        onOpenCampaign={vi.fn()}
        onRemoteAuthenticated={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Campaigns could not be loaded.',
    );
  });
});
