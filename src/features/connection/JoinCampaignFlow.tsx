import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import {
  FormField,
  SelectInput,
  TextInput,
} from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import type {
  AuthenticationChallenge,
  ClientConnectionState,
  NetworkApi,
  RemotePlaySession,
  SavedConnection,
  TrustChallenge,
} from '../../shared/network';
import type { JoinCampaignDraft } from './types';
import { useDeleteConfirmation } from './useDeleteConfirmation';
import styles from './ConnectionScreen.module.css';

type JoinPhase = 'authentication' | 'endpoint' | 'trust';

type AttemptOrigin =
  | { kind: 'manual' }
  | { entry: SavedConnection; kind: 'saved' };

interface JoinCampaignFlowProps {
  connectionNotice?: string | null;
  draft: JoinCampaignDraft;
  networkApi: NetworkApi;
  onAuthenticated: (session: RemotePlaySession) => void;
  onChange: (draft: JoinCampaignDraft) => void;
}

export function JoinCampaignFlow({
  connectionNotice = null,
  draft,
  networkApi,
  onAuthenticated,
  onChange,
}: JoinCampaignFlowProps) {
  const [phase, setPhase] = useState<JoinPhase>('endpoint');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [trustChallenge, setTrustChallenge] = useState<TrustChallenge | null>(null);
  const [authChallenge, setAuthChallenge] = useState<AuthenticationChallenge | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');
  const [useSavedPassword, setUseSavedPassword] = useState(false);
  const [history, setHistory] = useState<SavedConnection[]>([]);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(connectionNotice);
  const [isBusy, setIsBusy] = useState(false);
  const [clientState, setClientState] = useState<ClientConnectionState>('idle');
  const [attemptOrigin, setAttemptOrigin] = useState<AttemptOrigin | null>(null);
  const trustTriggerRef = useRef<HTMLElement | null>(null);
  const { clear: clearHistoryDeleteConfirmation, pendingId: pendingHistoryDeleteId, request: requestHistoryDeleteConfirmation, } = useDeleteConfirmation();

  const selectedUser = useMemo(
    () =>
      authChallenge?.users.find((user) => user.id === selectedUserId) ??
      null,
    [authChallenge, selectedUserId],
  );

  useEffect(() => {
    let current = true;
    void networkApi.listHistory().then((result) => {
      if (current && result.ok) {
        setHistory(result.value);
      }
    });
    return () => {
      current = false;
    };
  }, [networkApi]);

  useEffect(
    () =>
      networkApi.onClientStateChanged((event) => {
        setClientState(event.state);
      }),
    [networkApi],
  );

  const resetAttemptState = () => {
    setAttemptId(null);
    setAttemptOrigin(null);
    setTrustChallenge(null);
    setAuthChallenge(null);
    setSelectedUserId('');
    setPassword('');
    setUseSavedPassword(false);
    setPhase('endpoint');
  };

  const configureManualAuthentication = (
    challenge: AuthenticationChallenge,
  ) => {
    const preferred =
      challenge.users.find(
        (user) =>
          history.find(
            (entry) => entry.campaignId === challenge.campaignId,
          )?.lastUserId === user.id,
      ) ?? challenge.users[0];
    setAuthChallenge(challenge);
    setAttemptId(challenge.attemptId);
    setSelectedUserId(preferred?.id ?? '');
    setUseSavedPassword(preferred?.hasSavedPassword ?? false);
    setPassword('');
    setTrustChallenge(null);
    setError(null);
    setPhase('authentication');
  };

  const removeFailedSavedConnection = async (
    entry: SavedConnection,
    activeAttemptId: string,
    authenticationError: string,
  ) => {
    try {
      await networkApi.cancelConnection({ attemptId: activeAttemptId });
    } catch {
      // Deleting the unusable record still prevents another automatic retry.
    }

    setDeletingHistoryId(entry.campaignId);
    clearHistoryDeleteConfirmation();

    try {
      const deletion = await networkApi.deleteHistory({
        campaignId: entry.campaignId,
      });

      if (deletion.ok) {
        setHistory((current) =>
          current.filter(
            (candidate) => candidate.campaignId !== entry.campaignId,
          ),
        );
        setError(authenticationError);
      } else {
        setError(
          `${authenticationError} ${deletion.error.message}`,
        );
      }
    } catch {
      setError(
        `${authenticationError} Saved campaign could not be deleted.`,
      );
    } finally {
      setDeletingHistoryId(null);
      resetAttemptState();
    }
  };

  const authenticateSavedConnection = async (
    challenge: AuthenticationChallenge,
    entry: SavedConnection,
  ) => {
    const savedUser = challenge.users.find(
      (user) =>
        user.id === entry.lastUserId && user.hasSavedPassword,
    );

    if (!savedUser) {
      await removeFailedSavedConnection(
        entry,
        challenge.attemptId,
        'Saved credentials are no longer valid for this campaign.',
      );
      return;
    }

    try {
      const result = await networkApi.authenticate({
        attemptId: challenge.attemptId,
        password: undefined,
        useSavedPassword: true,
        userId: savedUser.id,
      });

      if (!result.ok) {
        await removeFailedSavedConnection(
          entry,
          challenge.attemptId,
          result.error.message,
        );
        return;
      }

      resetAttemptState();
      setError(null);
      onAuthenticated(result.value);
    } catch {
      await removeFailedSavedConnection(
        entry,
        challenge.attemptId,
        'Saved credentials could not be authenticated.',
      );
    }
  };

  const continueWithAuthentication = async (
    challenge: AuthenticationChallenge,
    origin: AttemptOrigin,
  ) => {
    if (origin.kind === 'saved') {
      await authenticateSavedConnection(challenge, origin.entry);
      return;
    }

    configureManualAuthentication(challenge);
  };

  const connect = async (
    endpoint: JoinCampaignDraft,
    savedEntry?: SavedConnection,
  ) => {
    if (deletingHistoryId) {
      return;
    }

    const port = Number(endpoint.port);
    if (
      endpoint.host.trim().length === 0 ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      return;
    }

    trustTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    clearHistoryDeleteConfirmation();
    setIsBusy(true);
    setError(null);
    const origin: AttemptOrigin = savedEntry
      ? { entry: savedEntry, kind: 'saved' }
      : { kind: 'manual' };
    setAttemptOrigin(origin);
    onChange({ host: endpoint.host.trim(), port: String(port) });
    try {
      const result = await networkApi.connect({
        expectedCampaignId: savedEntry?.campaignId,
        host: endpoint.host.trim(),
        port,
      });
      if (!result.ok) {
        resetAttemptState();
        setError(result.error.message);
        return;
      }
      if (result.value.state === 'trust_required') {
        setAttemptId(result.value.challenge.attemptId);
        setTrustChallenge(result.value.challenge);
        setPhase('trust');
      } else {
        await continueWithAuthentication(
          result.value.challenge,
          origin,
        );
      }
    } catch {
      resetAttemptState();
      setError('The campaign server could not be reached.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleEndpointSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void connect(draft);
  };

  const handleTrust = async () => {
    if (!attemptId) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const result = await networkApi.acceptTrust({ attemptId });

      if (result.ok) {
        await continueWithAuthentication(
          result.value,
          attemptOrigin ?? { kind: 'manual' },
        );
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('Campaign trust could not be saved.');
    } finally {
      setIsBusy(false);
    }
  };

  const cancelAttempt = async () => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);

    try {
      if (attemptId) {
        await networkApi.cancelConnection({ attemptId });
      }
    } finally {
      resetAttemptState();
      setError(null);
      setIsBusy(false);
    }
  };

  const handleAuthentication = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!attemptId || !selectedUserId) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const result = await networkApi.authenticate({
        attemptId,
        password: useSavedPassword ? undefined : password,
        useSavedPassword,
        userId: selectedUserId,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      let completionError: string | null = null;

      try {
        await networkApi.disconnect();
      } catch {
        completionError =
          'The connection was saved, but the temporary session could not be closed.';
      }

      try {
        const updatedHistory = await networkApi.listHistory();
        if (updatedHistory.ok) {
          setHistory(updatedHistory.value);
        } else {
          completionError ??= updatedHistory.error.message;
        }
      } catch {
        completionError ??=
          'The connection was saved, but saved campaigns could not be refreshed.';
      }

      resetAttemptState();
      setError(completionError);
    } catch {
      setError('Campaign credentials could not be saved.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleHistoryDelete = async (campaignId: string) => {
    if (
      deletingHistoryId ||
      !requestHistoryDeleteConfirmation(campaignId)
    ) {
      return;
    }

    setDeletingHistoryId(campaignId);
    setError(null);

    try {
      const result = await networkApi.deleteHistory({ campaignId });

      if (result.ok) {
        setHistory((current) =>
          current.filter((entry) => entry.campaignId !== campaignId),
        );
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('Saved campaign could not be deleted.');
    } finally {
      clearHistoryDeleteConfirmation();
      setDeletingHistoryId(null);
    }
  };

  const displayedError = error ?? connectionNotice;
  const isEndpointLocked = phase !== 'endpoint' || isBusy;

  return (
    <>
      <form
        className={styles.form}
        onSubmit={
          phase === 'authentication'
            ? handleAuthentication
            : handleEndpointSubmit
        }
      >
        <div className={styles.connectionFields}>
          <FormField htmlFor="campaign-host" label="IP address or host">
            <TextInput
              id="campaign-host"
              name="host"
              type="text"
              placeholder="IP address or host"
              value={draft.host}
              autoComplete="url"
              spellCheck={false}
              required
              disabled={isEndpointLocked}
              onChange={(event) =>
                onChange({ ...draft, host: event.currentTarget.value })
              }
            />
          </FormField>
          <FormField htmlFor="campaign-port" label="Port">
            <TextInput
              id="campaign-port"
              name="port"
              type="number"
              min="1"
              max="65535"
              inputMode="numeric"
              placeholder="Port"
              value={draft.port}
              required
              disabled={isEndpointLocked}
              onChange={(event) =>
                onChange({ ...draft, port: event.currentTarget.value })
              }
            />
          </FormField>
          <Button
            className={styles.formAction}
            type="submit"
            variant="primary"
            disabled={
              phase !== 'endpoint' ||
              isBusy ||
              deletingHistoryId !== null
            }
          >
            {phase === 'endpoint' && isBusy
              ? 'Connecting…'
              : 'Connect'}
          </Button>
        </div>

        {phase === 'authentication' && authChallenge ? (
          <div className={styles.authenticationStep}>
            {authChallenge.users.length > 0 ? (
              <div className={styles.authenticationFields}>
                <FormField htmlFor="campaign-username" label="Username">
                  <SelectInput
                    id="campaign-username"
                    value={selectedUserId}
                    disabled={isBusy}
                    onChange={(event) => {
                      const userId = event.currentTarget.value;
                      const user = authChallenge.users.find(
                        (candidate) => candidate.id === userId,
                      );
                      setSelectedUserId(userId);
                      setUseSavedPassword(
                        user?.hasSavedPassword ?? false,
                      );
                      setPassword('');
                      setError(null);
                    }}
                  >
                    {authChallenge.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField htmlFor="campaign-password" label="Password">
                  <TextInput
                    id="campaign-password"
                    autoComplete="current-password"
                    type="password"
                    disabled={isBusy}
                    value={
                      useSavedPassword &&
                        selectedUser?.hasSavedPassword
                        ? '••••••••'
                        : password
                    }
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      setUseSavedPassword(false);
                      setPassword(event.currentTarget.value);
                      setError(null);
                    }}
                  />
                </FormField>
                <Button
                  className={styles.formAction}
                  type="submit"
                  variant="primary"
                  disabled={isBusy}
                >
                  {clientState === 'associating_udp'
                    ? 'Securing UDP…'
                    : isBusy
                      ? 'Authenticating…'
                      : 'Save Credentials'}
                </Button>
              </div>
            ) : (
              <p className={styles.stepCopy}>
                No player accounts are configured for this campaign.
              </p>
            )}
          </div>
        ) : null}
      </form>

      {phase !== 'trust' && displayedError ? (
        <p className={styles.status} role="alert">{displayedError}</p>
      ) : null}

      {history.length > 0 ? (
        <section
          className={styles.savedSection}
          aria-labelledby="connection-history-heading"
        >
          <div className={styles.divider}>
            <span aria-hidden="true" />
            <h2 id="connection-history-heading">Saved campaigns</h2>
            <span aria-hidden="true" />
          </div>
          <ul className={styles.savedList}>
            {history.map((entry) => {
              const isPendingDelete =
                pendingHistoryDeleteId === entry.campaignId;
              const isDeleting = deletingHistoryId === entry.campaignId;

              return (
                <li className={styles.savedEntry} key={entry.campaignId}>
                  <div className={styles.savedEntryCopy}>
                    <strong>{entry.campaignName}</strong>
                    <span>{`${entry.host}:${entry.port}`}</span>
                  </div>
                  <div className={styles.savedEntryActions}>
                    <Button
                      size="compact"
                      variant="danger"
                      aria-label={
                        isDeleting
                          ? `Deleting ${entry.campaignName}`
                          : isPendingDelete
                            ? `Confirm deletion of ${entry.campaignName}`
                            : `Delete ${entry.campaignName}`
                      }
                      aria-pressed={isPendingDelete}
                      disabled={
                        phase !== 'endpoint' ||
                        isBusy ||
                        deletingHistoryId !== null
                      }
                      onClick={() =>
                        void handleHistoryDelete(entry.campaignId)
                      }
                    >
                      {isDeleting
                        ? 'Deleting…'
                        : isPendingDelete
                          ? 'Confirm'
                          : 'Delete'}
                    </Button>
                    <Button
                      size="compact"
                      variant="secondary"
                      disabled={
                        phase !== 'endpoint' ||
                        isBusy ||
                        deletingHistoryId !== null
                      }
                      onClick={() => {
                        const endpoint = {
                          host: entry.host,
                          port: String(entry.port),
                        };
                        onChange(endpoint);
                        void connect(endpoint, entry);
                      }}
                    >
                      Connect
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Modal
        accessibleLabel={
          trustChallenge?.kind === 'changed'
            ? 'Campaign identity changed'
            : 'Trust this campaign'
        }
        dismissDisabled={isBusy}
        isOpen={phase === 'trust' && trustChallenge !== null}
        returnFocusRef={trustTriggerRef}
        onDismiss={() => void cancelAttempt()}
      >
        {trustChallenge ? (
          <div className={styles.trustModalContent}>
            {trustChallenge.oldFingerprint ? (
              <div className={styles.fingerprint}>
                <span>
                  {`${trustChallenge.campaignName} Previously Trusted Fingerprint`}
                </span>
                <code>{trustChallenge.oldFingerprint}</code>
              </div>
            ) : null}
            <div className={styles.fingerprint}>
              <span>
                {`${trustChallenge.campaignName} Presented Fingerprint`}
              </span>
              <code>{trustChallenge.newFingerprint}</code>
            </div>
            {error ? (
              <p className={styles.status} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.modalActions}>
              <Button
                disabled={isBusy}
                type="button"
                onClick={() => void cancelAttempt()}
              >
                Cancel
              </Button>
              <Button
                disabled={isBusy}
                type="button"
                variant="primary"
                onClick={() => void handleTrust()}
              >
                {trustChallenge.kind === 'changed'
                  ? 'Replace Trust'
                  : 'Trust'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
