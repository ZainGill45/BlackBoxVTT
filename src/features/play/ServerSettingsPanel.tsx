import { Check, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { Collapsible } from '../../components/ui/Collapsible';
import { FormField, TextInput } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MAX_MANAGED_USERS,
  MIN_TRANSFORM_PREVIEW_RATE,
  type HostStatus,
  type ManagedUserView,
  type ServerSettingsView,
} from '../../shared/network';
import styles from './ServerSettingsPanel.module.css';

export const USER_DELETE_CONFIRMATION_TIMEOUT_MS = 5_000;

interface ServerSettingsPanelProps {
  onCreateUser: (username: string, password: string) => void;
  onDeleteUser: (userId: string) => void;
  onPortChange: (port: number) => void;
  onTransformPreviewRateChange?: (rate: number) => void;
  onResetPassword: (userId: string, password: string) => void;
  onUpdateUsername: (userId: string, username: string) => void;
  settings: ServerSettingsView;
  status: HostStatus;
}

interface ManagedUserRowProps {
  deleteIsArmed: boolean;
  onDelete: () => void;
  onResetPassword: (password: string) => void;
  onUpdateUsername: (username: string) => void;
  user: ManagedUserView;
  users: readonly ManagedUserView[];
}

function normalizedUsername(username: string) {
  return username.normalize('NFKC').trim();
}

function usernameKey(username: string) {
  return normalizedUsername(username).toLocaleLowerCase('en-US');
}

function usernameIsAvailable(
  username: string,
  users: readonly ManagedUserView[],
  excludedId?: string,
) {
  const normalized = normalizedUsername(username);

  return (
    normalized.length >= 1 &&
    normalized.length <= 64 &&
    !users.some(
      (user) =>
        user.id !== excludedId &&
        usernameKey(user.username) === usernameKey(normalized),
    )
  );
}

function isIpv4(address: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address);
}

function selectLocalAddress(addresses: readonly string[]) {
  return (
    addresses.find((address) => address.startsWith('192.168.')) ??
    addresses.find((address) => address.startsWith('10.')) ??
    addresses.find((address) => {
      const match = /^172\.(\d{1,2})\./.exec(address);
      const secondOctet = Number(match?.[1]);
      return secondOctet >= 16 && secondOctet <= 31;
    }) ??
    addresses.find(isIpv4) ??
    addresses.find(
      (address) => !address.toLocaleLowerCase().startsWith('fe80:'),
    ) ??
    addresses[0] ??
    null
  );
}

function selectPublicAddress(addresses: readonly string[]) {
  return addresses.find(isIpv4) ?? addresses[0] ?? null;
}

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function ManagedUserRow({
  deleteIsArmed,
  onDelete,
  onResetPassword,
  onUpdateUsername,
  user,
  users,
}: ManagedUserRowProps) {
  const [usernameDraft, setUsernameDraft] = useState(user.username);
  const [passwordDraft, setPasswordDraft] = useState('');

  const commitUsername = () => {
    const normalized = normalizedUsername(usernameDraft);

    if (usernameIsAvailable(normalized, users, user.id)) {
      setUsernameDraft(normalized);
      if (normalized !== user.username) {
        onUpdateUsername(normalized);
        setUsernameDraft(user.username);
      }
    } else {
      setUsernameDraft(user.username);
    }
  };

  const commitPassword = () => {
    if (passwordDraft.length > 0) {
      onResetPassword(passwordDraft);
      setPasswordDraft('');
    }
  };

  return (
    <div className={styles.userRow}>
      <TextInput
        aria-label={`Username for ${user.username}`}
        autoComplete="off"
        className={styles.userInput}
        maxLength={64}
        placeholder="Username"
        value={usernameDraft}
        onBlur={commitUsername}
        onChange={(event) => setUsernameDraft(event.currentTarget.value)}
        onKeyDown={blurOnEnter}
      />
      <TextInput
        aria-label={`New password for ${user.username}`}
        autoComplete="new-password"
        className={styles.userInput}
        placeholder="Reset Password"
        type="password"
        value={passwordDraft}
        onBlur={commitPassword}
        onChange={(event) => setPasswordDraft(event.currentTarget.value)}
        onKeyDown={blurOnEnter}
      />
      <Button
        aria-label={
          deleteIsArmed
            ? `Confirm deletion of ${user.username}`
            : `Delete ${user.username}`
        }
        aria-pressed={deleteIsArmed}
        className={styles.deleteButton}
        size="compact"
        variant="danger"
        onClick={onDelete}
      >
        {deleteIsArmed ? (
          <Check aria-hidden size="1.125rem" strokeWidth={1.75} />
        ) : (
          <Trash2 aria-hidden size="1.125rem" strokeWidth={1.75} />
        )}
      </Button>
    </div>
  );
}

export function ServerSettingsPanel({
  onCreateUser,
  onDeleteUser,
  onPortChange,
  onTransformPreviewRateChange,
  onResetPassword,
  onUpdateUsername,
  settings,
  status,
}: ServerSettingsPanelProps) {
  const [portDraft, setPortDraft] = useState(String(settings.port));
  const [previewRateDraft, setPreviewRateDraft] = useState(
    String(settings.transformPreviewRate ?? 60),
  );
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewUser, setShowNewUser] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const newUsernameRef = useRef<HTMLInputElement | null>(null);
  const previewRateInputRef = useRef<HTMLInputElement | null>(null);
  const previewRateIsEditing = useRef(false);

  useEffect(() => {
    if (!pendingDeleteId) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingDeleteId(null);
    }, USER_DELETE_CONFIRMATION_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingDeleteId]);

  useEffect(() => {
    if (!previewRateIsEditing.current) {
      setPreviewRateDraft(String(settings.transformPreviewRate ?? 60));
    }
  }, [settings.transformPreviewRate]);

  const playerLabel =
    status.connectedPlayerCount === 1
      ? '1 Player Connected'
      : `${status.connectedPlayerCount} Players Connected`;
  const stateLabel = status.state === 'online' ? 'Online' : 'Offline';
  const ServerStateIcon = status.state === 'online' ? Power : PowerOff;
  const localAddress = selectLocalAddress(status.localAddresses);
  const publicAddress = selectPublicAddress(status.publicAddresses);

  const copyAddress = async (address: string) => {
    if (!navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
    } catch {
      // The address remains selectable if clipboard access is unavailable.
    }
  };

  const handlePortSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const port = Number(portDraft);
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
      onPortChange(port);
      setPortDraft(String(settings.port));
    }
  };

  const handleAddUser = () => {
    if (showNewUser || settings.users.length >= MAX_MANAGED_USERS) {
      return;
    }
    setShowNewUser(true);
    setNewUsername('');
    setNewPassword('');
    window.setTimeout(() => newUsernameRef.current?.focus());
  };

  const handleDraftSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !usernameIsAvailable(newUsername, settings.users) ||
      newPassword.length === 0
    ) {
      return;
    }
    onCreateUser(normalizedUsername(newUsername), newPassword);
    setShowNewUser(false);
    setNewUsername('');
    setNewPassword('');
  };

  const handleDeleteUser = (user: ManagedUserView) => {
    if (pendingDeleteId !== user.id) {
      setPendingDeleteId(user.id);
      return;
    }
    onDeleteUser(user.id);
    setPendingDeleteId(null);
  };

  const commitPreviewRate = () => {
    const rate = Number(previewRateDraft);
    if (
      Number.isInteger(rate) &&
      rate >= MIN_TRANSFORM_PREVIEW_RATE &&
      rate <= MAX_TRANSFORM_PREVIEW_RATE
    ) {
      setPreviewRateDraft(String(rate));
      if (rate !== (settings.transformPreviewRate ?? 60)) {
        onTransformPreviewRateChange?.(rate);
      }
    } else {
      setPreviewRateDraft(String(settings.transformPreviewRate ?? 60));
    }
  };

  const renderAddresses = (addresses: string[]) =>
    addresses.length > 0
      ? addresses.map((address) => <span key={address}>{address}</span>)
      : 'Unavailable';

  return (
    <div className={styles.panel}>
      <p className={styles.statusBanner} role="status">
        {`Server ${stateLabel} ${playerLabel}`}
      </p>

      <section
        className={`${styles.section} ${styles.serverSection}`}
        aria-labelledby="server-management"
      >
        <h2 id="server-management" className={styles.sectionTitle}>
          Server Management
        </h2>

        <div className={styles.joinAddresses}>
          <div className={styles.joinAddress}>
            <div className={styles.joinAddressCopy}>
              <strong>Same network</strong>
              <span>Players on your Wi-Fi or LAN</span>
            </div>
            <div className={styles.endpoint}>
              <code aria-label="Same network address">
                {localAddress ?? 'Unavailable'}
              </code>
              {localAddress ? (
                <Button
                  size="compact"
                  type="button"
                  onClick={() => void copyAddress(localAddress)}
                >
                  {copiedAddress === localAddress ? 'Copied' : 'Copy'}
                </Button>
              ) : null}
            </div>
          </div>
          <div className={styles.joinAddress}>
            <div className={styles.joinAddressCopy}>
              <strong>Over the internet</strong>
              <span>Remote players outside your network</span>
            </div>
            <div className={styles.endpoint}>
              <code aria-label="Internet address">
                {publicAddress ?? 'Unavailable'}
              </code>
              {publicAddress ? (
                <Button
                  size="compact"
                  type="button"
                  onClick={() => void copyAddress(publicAddress)}
                >
                  {copiedAddress === publicAddress ? 'Copied' : 'Copy'}
                </Button>
              ) : null}
            </div>
          </div>
          <div className={styles.joinAddress}>
            <div className={styles.joinAddressCopy}>
              <strong>Network update rate</strong>
              <span>Updates sent to connected players each second</span>
            </div>
            <label
              className={styles.updateRateControl}
              htmlFor="transform-preview-rate"
            >
              <input
                ref={previewRateInputRef}
                aria-label="Update Rate"
                className={styles.updateRateInput}
                id="transform-preview-rate"
                inputMode="numeric"
                max={MAX_TRANSFORM_PREVIEW_RATE}
                min={MIN_TRANSFORM_PREVIEW_RATE}
                step={1}
                type="number"
                value={previewRateDraft}
                onBlur={() => {
                  previewRateIsEditing.current = false;
                  commitPreviewRate();
                }}
                onChange={(event) =>
                  setPreviewRateDraft(event.currentTarget.value)
                }
                onFocus={() => {
                  previewRateIsEditing.current = true;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    previewRateInputRef.current?.blur();
                  }
                }}
              />
            </label>
          </div>
        </div>

        <Collapsible
          className={styles.advancedDetails}
          contentClassName={styles.advancedContent}
          label="Advanced Details"
        >
          <dl className={styles.ipList}>
            <div className={styles.ipRow}>
              <dt>All local addresses</dt>
              <dd>{renderAddresses(status.localAddresses)}</dd>
            </div>
            <div className={styles.ipRow}>
              <dt>All public addresses</dt>
              <dd>{renderAddresses(status.publicAddresses)}</dd>
            </div>
            <div className={styles.ipRow}>
              <dt>Certificate fingerprint</dt>
              <dd>{status.certificateFingerprint ?? 'Unavailable'}</dd>
            </div>
          </dl>
        </Collapsible>

        <form className={styles.portForm} onSubmit={handlePortSubmit}>
          <span
            className={styles.serverIndicator}
            data-state={status.state}
            role="img"
            aria-label={`Server status: ${stateLabel}`}
          >
            <ServerStateIcon aria-hidden size="1rem" strokeWidth={1.75} />
          </span>
          <FormField htmlFor="server-port" label="Server port">
            <TextInput
              id="server-port"
              inputMode="numeric"
              max={65_535}
              min={1}
              placeholder="Port"
              required
              step={1}
              type="number"
              value={portDraft}
              onChange={(event) => setPortDraft(event.currentTarget.value)}
            />
          </FormField>
          <Button size="compact" type="submit">
            Save
          </Button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="user-management">
        <div className={styles.sectionHeader}>
          <h2 id="user-management" className={styles.sectionTitle}>
            User Management
          </h2>
          <IconButton
            className={styles.headerAction}
            disabled={settings.users.length >= MAX_MANAGED_USERS}
            icon={Plus}
            label="Add user"
            onClick={handleAddUser}
          />
        </div>

        {showNewUser ? (
          <form className={styles.draftForm} onSubmit={handleDraftSubmit}>
            <TextInput
              ref={newUsernameRef}
              aria-label="New username"
              autoComplete="off"
              maxLength={64}
              placeholder="Username"
              value={newUsername}
              onChange={(event) => setNewUsername(event.currentTarget.value)}
            />
            <TextInput
              aria-label="New password"
              autoComplete="new-password"
              placeholder="Password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
            />
            <div className={styles.draftActions}>
              <Button
                size="compact"
                type="button"
                onClick={() => setShowNewUser(false)}
              >
                Cancel
              </Button>
              <Button size="compact" type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        ) : null}

        {settings.users.length > 0 ? (
          <div className={styles.userList}>
            {settings.users.map((user) => (
              <ManagedUserRow
                key={`${user.id}:${user.username}`}
                deleteIsArmed={pendingDeleteId === user.id}
                user={user}
                users={settings.users}
                onDelete={() => handleDeleteUser(user)}
                onResetPassword={(password) =>
                  onResetPassword(user.id, password)
                }
                onUpdateUsername={(username) =>
                  onUpdateUsername(user.id, username)
                }
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
