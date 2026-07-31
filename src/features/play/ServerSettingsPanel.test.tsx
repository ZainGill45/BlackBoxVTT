import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MANAGED_USERS,
  type HostStatus,
  type ManagedUserView,
  type ServerSettingsView,
} from '../../shared/network';
import {
  createDefaultServerSettings,
  OFFLINE_SERVER_STATUS,
} from './serverSettings';
import {
  ServerSettingsPanel,
  USER_DELETE_CONFIRMATION_TIMEOUT_MS,
} from './ServerSettingsPanel';

function createUser(index: number, username = `User ${index}`): ManagedUserView {
  return {
    connected: false,
    hasPassword: true,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    username,
  };
}

interface HarnessProps {
  initialSettings?: ServerSettingsView;
  status?: HostStatus;
}

function Harness({
  initialSettings = createDefaultServerSettings(),
  status = OFFLINE_SERVER_STATUS,
}: HarnessProps) {
  const [settings, setSettings] = useState(initialSettings);
  return (
    <>
      <ServerSettingsPanel
        settings={settings}
        status={status}
        onCreateUser={(username) =>
          setSettings((current) => ({
            ...current,
            users: [...current.users, createUser(current.users.length + 1, username)],
          }))
        }
        onDeleteUser={(userId) =>
          setSettings((current) => ({
            ...current,
            users: current.users.filter((user) => user.id !== userId),
          }))
        }
        onPortChange={(port) =>
          setSettings((current) => ({ ...current, port }))
        }
        onTransformPreviewRateChange={(transformPreviewRate) =>
          setSettings((current) => ({ ...current, transformPreviewRate }))
        }
        onResetPassword={() => undefined}
        onUpdateUsername={(userId, username) =>
          setSettings((current) => ({
            ...current,
            users: current.users.map((user) =>
              user.id === userId ? { ...user, username } : user,
            ),
          }))
        }
      />
      <pre data-testid="settings-state">{JSON.stringify(settings)}</pre>
    </>
  );
}

function getSettings(): ServerSettingsView {
  return JSON.parse(
    screen.getByTestId('settings-state').textContent ?? '{}',
  ) as ServerSettingsView;
}

afterEach(() => vi.useRealTimers());

describe('ServerSettingsPanel', () => {
  it('prioritizes useful addresses and collapses diagnostics', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        status={{
          boundFamilies: ['IPv4', 'IPv6'],
          certificateFingerprint: 'AA:BB:CC',
          connectedPlayerCount: 1,
          effectivePort: 30_000,
          localAddresses: [
            '172.27.80.1',
            '192.168.1.25',
            '2001:db8::1',
          ],
          publicAddresses: ['203.0.113.12'],
          state: 'online',
        }}
      />,
    );

    expect(
      screen.getByText('Server Online 1 Player Connected'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Same network address')).toHaveTextContent(
      '192.168.1.25',
    );
    expect(screen.getByLabelText('Internet address')).toHaveTextContent(
      '203.0.113.12',
    );
    expect(screen.queryByText(/requires this port to be forwarded/i)).toBeNull();
    const advancedTrigger = screen.getByRole('button', {
      name: /advanced details/i,
    });
    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(advancedTrigger);
    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('172.27.80.1')).toBeInTheDocument();
    expect(screen.getByText('2001:db8::1')).toBeInTheDocument();
    expect(screen.getAllByText('203.0.113.12')).toHaveLength(2);
    expect(screen.getByText('AA:BB:CC')).toBeInTheDocument();
  });

  it('saves only a valid port', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const port = screen.getByLabelText('Server port');

    await user.clear(port);
    await user.type(port, '31000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(getSettings().port).toBe(31_000);

    await user.clear(port);
    await user.type(port, '70000');
    fireEvent.submit(port.closest('form')!);
    expect(getSettings().port).toBe(31_000);
  });

  it('shows the network update rate panel and saves on blur or Enter', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialSettings={{
          port: 30_000,
          transformPreviewRate: 60,
          users: [],
        }}
      />,
    );

    const rate = screen.getByLabelText('Update Rate');
    expect(screen.getByText('Network update rate')).toBeInTheDocument();
    expect(
      screen.getByText('Updates sent to connected players each second'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Hz')).not.toBeInTheDocument();

    await user.clear(rate);
    await user.type(rate, '90');
    await user.tab();
    expect(getSettings().transformPreviewRate).toBe(90);

    await user.clear(rate);
    await user.type(rate, '129');
    await user.tab();
    expect(rate).toHaveValue(90);
    expect(getSettings().transformPreviewRate).toBe(90);

    await user.clear(rate);
    await user.type(rate, '75{Enter}');
    expect(rate).not.toHaveFocus();
    expect(getSettings().transformPreviewRate).toBe(75);
  });

  it('synchronizes persisted update rates without overwriting an active draft', () => {
    const onTransformPreviewRateChange = vi.fn();
    const settings = {
      port: 30_000,
      transformPreviewRate: 60,
      users: [],
    };
    const props = {
      onCreateUser: vi.fn(),
      onDeleteUser: vi.fn(),
      onPortChange: vi.fn(),
      onResetPassword: vi.fn(),
      onTransformPreviewRateChange,
      onUpdateUsername: vi.fn(),
      settings,
      status: OFFLINE_SERVER_STATUS,
    };
    const { rerender } = render(<ServerSettingsPanel {...props} />);
    const rate = screen.getByLabelText('Update Rate');

    rerender(
      <ServerSettingsPanel
        {...props}
        settings={{ ...settings, transformPreviewRate: 128 }}
      />,
    );
    expect(rate).toHaveValue(128);

    fireEvent.focus(rate);
    fireEvent.change(rate, { target: { value: '80' } });
    rerender(
      <ServerSettingsPanel
        {...props}
        settings={{ ...settings, transformPreviewRate: 32 }}
      />,
    );
    expect(rate).toHaveValue(80);
    fireEvent.blur(rate);
    expect(onTransformPreviewRateChange).toHaveBeenCalledWith(80);
  });

  it('creates a trimmed user with masked password inputs', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    const username = screen.getByLabelText('New username');
    const password = screen.getByLabelText('New password');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(username, '  Alice  ');
    await user.type(password, ' password ');
    await user.click(
      within(screen.getByRole('region', { name: 'User Management' }))
        .getByRole('button', { name: 'Save' }),
    );

    expect(getSettings().users[0].username).toBe('Alice');
    expect(screen.getByLabelText('New password for Alice')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByTestId('settings-state')).not.toHaveTextContent(
      'password',
    );
  });

  it('commits username and replacement-password edits on blur', async () => {
    const user = userEvent.setup();
    const onResetPassword = vi.fn();
    const onUpdateUsername = vi.fn();
    const alice = createUser(1, 'Alice');
    render(
      <ServerSettingsPanel
        settings={{ port: 30_000, users: [alice] }}
        status={OFFLINE_SERVER_STATUS}
        onCreateUser={vi.fn()}
        onDeleteUser={vi.fn()}
        onPortChange={vi.fn()}
        onResetPassword={onResetPassword}
        onUpdateUsername={onUpdateUsername}
      />,
    );

    const username = screen.getByLabelText('Username for Alice');
    await user.clear(username);
    await user.type(username, 'Alicia');
    await user.tab();
    expect(onUpdateUsername).toHaveBeenCalledWith(alice.id, 'Alicia');

    const password = screen.getByLabelText('New password for Alice');
    await user.type(password, 'new secret');
    await user.tab();
    expect(onResetPassword).toHaveBeenCalledWith(alice.id, 'new secret');
    expect(password).toHaveValue('');
  });

  it('requires confirmation before deleting a user', () => {
    vi.useFakeTimers();
    const onDeleteUser = vi.fn();
    const alice = createUser(1, 'Alice');
    render(
      <ServerSettingsPanel
        settings={{ port: 30_000, users: [alice] }}
        status={OFFLINE_SERVER_STATUS}
        onCreateUser={vi.fn()}
        onDeleteUser={onDeleteUser}
        onPortChange={vi.fn()}
        onResetPassword={vi.fn()}
        onUpdateUsername={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Alice' }));
    expect(onDeleteUser).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(USER_DELETE_CONFIRMATION_TIMEOUT_MS));
    expect(
      screen.getByRole('button', { name: 'Delete Alice' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Alice' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deletion of Alice' }),
    );
    expect(onDeleteUser).toHaveBeenCalledWith(alice.id);
  });

  it('disables account creation at the twenty-user capacity', () => {
    render(
      <Harness
        initialSettings={{
          port: 30_000,
          users: Array.from({ length: MAX_MANAGED_USERS }, (_, index) =>
            createUser(index + 1),
          ),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
  });
});
