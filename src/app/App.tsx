import { useEffect, useRef, useState } from 'react';
import { CanonicalLoader } from '../components/ui/CanonicalLoader';
import { ErrorModal } from '../components/ui/ErrorModal';
import { ConnectionScreen } from '../features/connection/ConnectionScreen';
import type {
  ConnectionScreenProps,
  CreateCampaignDraft,
} from '../features/connection/types';
import { PlayScreen } from '../features/play/PlayScreen';
import {
  preloadCampaign,
  releaseCampaignPreload,
  type CampaignPreload,
} from '../features/play/campaignPreload';
import {
  createDefaultServerSettings,
  OFFLINE_SERVER_STATUS,
} from '../features/play/serverSettings';
import type { PlaySession } from '../features/play/types';
import type { ApplicationApi } from '../shared/application';
import type {
  AssetApi,
  AssetErrorEvent,
  AssetProgressEvent,
} from '../shared/assets';
import {
  isUnavailableCampaignSummary,
  type CampaignApi,
  type CampaignManifest,
  type CampaignResult,
  type CampaignSummary,
} from '../shared/campaigns';
import type {
  HostStatus,
  NetworkApi,
  ServerSettingsView,
} from '../shared/network';
import type { SceneApi } from '../shared/scenes';
import type { JournalApi } from '../shared/journal';
import type { JournalWindowApi } from '../shared/journalWindows';
import styles from './App.module.css';

interface AppProps {
  applicationApi?: ApplicationApi;
  assetApi?: AssetApi;
  campaignApi?: CampaignApi;
  journalApi?: JournalApi;
  journalWindowApi?: JournalWindowApi;
  networkApi?: NetworkApi;
  sceneApi?: SceneApi;
}

function sortCampaigns(campaigns: readonly CampaignSummary[]) {
  return [...campaigns].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

export function App({
  applicationApi = window.blackBox.application,
  assetApi = window.blackBox.assets,
  campaignApi = window.blackBox.campaigns,
  journalApi = window.blackBox.journal,
  journalWindowApi = window.blackBox.journalWindows,
  networkApi = window.blackBox.network,
  sceneApi = window.blackBox.scenes,
}: AppProps) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignLoadState, setCampaignLoadState] =
    useState<ConnectionScreenProps['campaignLoadState']>('loading');
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(
    null,
  );
  const [playSession, setPlaySession] = useState<PlaySession | null>(null);
  const [serverSettings, setServerSettings] = useState<ServerSettingsView>(
    createDefaultServerSettings(),
  );
  const [hostStatus, setHostStatus] =
    useState<HostStatus>(OFFLINE_SERVER_STATUS);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(
    null,
  );
  const [assetError, setAssetError] = useState<AssetErrorEvent | null>(null);
  const [assetProgress, setAssetProgress] =
    useState<AssetProgressEvent | null>(null);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const [showSyncLoader, setShowSyncLoader] = useState(false);
  const [preload, setPreload] = useState<CampaignPreload | null>(null);
  const [preloadLabel, setPreloadLabel] = useState<string | null>(null);
  /* Invalidates async entry work when a newer attempt starts or a remote
     session closes before its assets and campaign reads have finished. */
  const entryRequestRef = useRef(0);

  useEffect(() => {
    const removeHostListener = networkApi.onHostStatusChanged(setHostStatus);
    const removeClosedListener = networkApi.onSessionClosed((event) => {
      entryRequestRef.current += 1;
      setPlaySession((current) =>
        current?.source === 'remote' ? null : current,
      );
      setPreload(null);
      setPreloadLabel(null);
      setSyncingRemote(false);
      setShowSyncLoader(false);
      setConnectionNotice(event.message);
    });
    void networkApi.getHostStatus().then(setHostStatus);

    return () => {
      entryRequestRef.current += 1;
      removeHostListener();
      removeClosedListener();
    };
  }, [networkApi]);

  useEffect(() => {
    const removeError = assetApi.onError(setAssetError);
    const removeProgress = assetApi.onProgress((event) => {
      if (event.scope === 'sync') {
        setAssetProgress(event);
      }
    });
    return () => {
      removeError();
      removeProgress();
    };
  }, [assetApi]);

  useEffect(() => {
    if (!syncingRemote) {
      return undefined;
    }
    const timer = window.setTimeout(() => setShowSyncLoader(true), 120);
    return () => window.clearTimeout(timer);
  }, [syncingRemote]);

  useEffect(() => {
    let isCurrent = true;

    void (async () => {
      try {
        const result = await campaignApi.list();

        if (!isCurrent) {
          return;
        }

        if (result.ok) {
          setCampaigns(sortCampaigns(result.value));
          setCampaignLoadError(null);
          setCampaignLoadState('ready');
        } else {
          setCampaignLoadError(result.error.message);
          setCampaignLoadState('error');
        }
      } catch {
        if (isCurrent) {
          setCampaignLoadError('Campaigns could not be loaded.');
          setCampaignLoadState('error');
        }
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [campaignApi]);

  // The host window is hidden until this fires, so it is never shown mid-load.
  // 'error' counts as ready: a failed campaign read still has to be visible,
  // otherwise the window would never appear at all.
  useEffect(() => {
    if (campaignLoadState !== 'loading') {
      applicationApi.ready();
    }
  }, [applicationApi, campaignLoadState]);

  const handleCreate = async (
    draft: CreateCampaignDraft,
  ): Promise<CampaignResult<CampaignManifest>> => {
    const result = await campaignApi.create({ name: draft.name });

    if (result.ok) {
      setCampaigns((current) => sortCampaigns([...current, result.value]));
    }

    return result;
  };

  const handleDeleteCampaign = async (
    id: string,
  ): Promise<CampaignResult<null>> => {
    const result = await campaignApi.trash({ id });

    if (result.ok) {
      setCampaigns((current) =>
        current.filter((campaign) => campaign.id !== id),
      );
    }

    return result;
  };

  const handleExportCampaign: ConnectionScreenProps['onExportCampaign'] =
    (id) => campaignApi.export({ id });

  const handleImportCampaign: ConnectionScreenProps['onImportCampaign'] =
    async () => {
      const result = await campaignApi.import();
      if (result.ok && result.value) {
        const importedCampaign = result.value.campaign;
        setCampaigns((current) =>
          sortCampaigns([...current, importedCampaign]),
        );
      }
      return result;
    };

  const handleSalvageCampaign: ConnectionScreenProps['onSalvageCampaign'] =
    async (id) => {
      const result = await campaignApi.salvage({ id });
      if (result.ok) {
        /* A failed trash is reported as a successful salvage with a warning.
           Keep that source entry visible so the warning's delete action is
           actually available to the Game Master. */
        const salvaged = result.value.campaign;
        setCampaigns((current) =>
          sortCampaigns([
            ...current.filter(
              (campaign) =>
                !result.value.originalTrashed || campaign.id !== id,
            ),
            salvaged,
          ]),
        );
      }
      return result;
    };

  /**
   * Reads a campaign's tabs, then enters it.
   *
   * The play screen is only built once it can be built complete. Its long-lived
   * stores are seeded before the sidebar panels mount, so a screen entered cold
   * does not show each tab empty while its first read is in flight.
   *
   * Reading ahead is best effort: whatever could not be read is simply left
   * out, and the store that owns it reads and reports it exactly as before.
   */
  const enterCampaign = async (
    session: PlaySession,
    request = ++entryRequestRef.current,
  ): Promise<void> => {
    if (request !== entryRequestRef.current) {
      return;
    }
    setPreloadLabel('Reading the campaign…');
    const nextPreload = await preloadCampaign({
      assetApi,
      campaignId: session.campaignId,
      journalApi,
      networkApi,
      onStep: (label) => {
        if (request === entryRequestRef.current) setPreloadLabel(label);
      },
      role: session.role === 'gm' ? 'gm' : 'player',
      sceneApi,
    }).finally(() => {
      if (request === entryRequestRef.current) setPreloadLabel(null);
    });
    if (request !== entryRequestRef.current) {
      releaseCampaignPreload(assetApi, nextPreload);
      return;
    }
    setPreload(nextPreload);
    setPlaySession(session);
  };

  const handleOpenCampaign = async (id: string): Promise<void> => {
    const campaign = campaigns.find((candidate) => candidate.id === id);

    if (!campaign || isUnavailableCampaignSummary(campaign)) {
      return;
    }
    const request = ++entryRequestRef.current;

    const session: PlaySession = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      role: 'gm',
      source: 'local',
      system: campaign.system,
    };
    setConnectionNotice(null);
    setServerSettings(createDefaultServerSettings());
    const result = await networkApi.openHost({ campaignId: campaign.id });
    if (request !== entryRequestRef.current) {
      return;
    }
    if (!result.ok) {
      setConnectionNotice(result.error.message);
      return;
    }
    await refreshServerSettings(campaign.id, request);
    await enterCampaign(session, request);
  };

  const refreshServerSettings = async (
    campaignId: string,
    entryRequest?: number,
  ) => {
    const result = await networkApi.getServerSettings({ campaignId });
    if (
      result.ok &&
      (entryRequest === undefined || entryRequest === entryRequestRef.current)
    ) {
      setServerSettings(result.value);
    }
  };

  const activeCampaignId =
    playSession?.source === 'local' ? playSession.campaignId : null;
  const serverSettingsActions = activeCampaignId
    ? {
        createUser: (username: string, password: string) =>
          networkApi.createUser({
            campaignId: activeCampaignId,
            password,
            username,
          }),
        deleteUser: (userId: string) =>
          networkApi.deleteUser({ campaignId: activeCampaignId, userId }),
        resetPassword: (userId: string, password: string) =>
          networkApi.resetPassword({
            campaignId: activeCampaignId,
            password,
            userId,
          }),
        setMaxChatMessageCharacters: (maxMessageCharacters: number) =>
          networkApi.setMaxChatMessageCharacters({
            campaignId: activeCampaignId,
            maxMessageCharacters,
          }),
        setPort: (port: number) =>
          networkApi.setPort({ campaignId: activeCampaignId, port }),
        setTransformPreviewRate: (transformPreviewRate: number) =>
          networkApi.setTransformPreviewRate({
            campaignId: activeCampaignId,
            transformPreviewRate,
          }),
        updateUsername: (userId: string, username: string) =>
          networkApi.updateUsername({
            campaignId: activeCampaignId,
            userId,
            username,
          }),
      }
    : null;

  const runServerSettingsAction = (
    action: (() => Promise<unknown>) | undefined,
  ) => {
    if (!activeCampaignId || !action) {
      return;
    }
    void action().then(() => refreshServerSettings(activeCampaignId));
  };

  const handleLogout = async () => {
    const session = playSession;
    if (!session) return;
    entryRequestRef.current += 1;
    setPreloadLabel(null);
    await journalWindowApi
      .closeCampaign({ campaignId: session.campaignId })
      .catch(() => undefined);
    if (session.source === 'local') {
      await networkApi.stopHost().catch(() => undefined);
      const result = await campaignApi.list();
      if (result.ok) setCampaigns(sortCampaigns(result.value));
    } else {
      await networkApi.disconnect().catch(() => undefined);
    }
    setPlaySession((current) =>
      current?.campaignId === session.campaignId ? null : current,
    );
    setPreload(null);
  };

  return (
    <main className={styles.application}>
      <section className={styles.shell} hidden={playSession !== null}>
        <h1 className="sr-only">Campaign connection</h1>
        <ConnectionScreen
          campaignLoadError={campaignLoadError}
          campaignLoadState={campaignLoadState}
          campaigns={campaigns}
          connectionNotice={connectionNotice}
          networkApi={networkApi}
          onCreate={handleCreate}
          onDeleteCampaign={handleDeleteCampaign}
          onExportCampaign={handleExportCampaign}
          onImportCampaign={handleImportCampaign}
          onSalvageCampaign={handleSalvageCampaign}
          onOpenCampaign={handleOpenCampaign}
          onRemoteAuthenticated={(session) => {
            const request = ++entryRequestRef.current;
            setConnectionNotice(null);
            setAssetProgress(null);
            setShowSyncLoader(false);
            setSyncingRemote(true);
            void assetApi
              .prepareRemote({ campaignId: session.campaignId })
              .then((result) => {
                if (request !== entryRequestRef.current) {
                  return undefined;
                }
                if (result.ok) {
                  // Chained so the loader stays up until the campaign is read.
                  return enterCampaign(session, request);
                }
                setAssetError({
                  ...result.error,
                  campaignId: session.campaignId,
                  title: 'Campaign asset synchronization failed',
                });
                return undefined;
              })
              .catch(() => {
                if (request !== entryRequestRef.current) {
                  return;
                }
                setAssetError({
                  campaignId: session.campaignId,
                  code: 'sync_error',
                  message: 'Campaign assets could not be synchronized.',
                  title: 'Campaign asset synchronization failed',
                });
              })
              .finally(() => {
                if (request === entryRequestRef.current) {
                  setSyncingRemote(false);
                  setShowSyncLoader(false);
                }
              });
          }}
        />
      </section>

      {playSession ? (
        <PlayScreen
          key={playSession.campaignId}
          applicationApi={applicationApi}
          assetApi={assetApi}
          networkApi={networkApi}
          journalApi={journalApi}
          journalWindowApi={journalWindowApi}
          preload={preload ?? undefined}
          sceneApi={sceneApi}
          session={playSession}
          serverSettings={
            playSession.source === 'local' ? serverSettings : undefined
          }
          serverStatus={
            playSession.source === 'local'
              ? hostStatus
              : undefined
          }
          onCreateServerUser={
            serverSettingsActions
              ? (username, password) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.createUser(username, password),
                  )
              : undefined
          }
          onDeleteServerUser={
            serverSettingsActions
              ? (userId) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.deleteUser(userId),
                  )
              : undefined
          }
          onServerPasswordReset={
            serverSettingsActions
              ? (userId, password) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.resetPassword(userId, password),
                  )
              : undefined
          }
          onServerPortChange={
            serverSettingsActions
              ? (port) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.setPort(port),
                  )
              : undefined
          }
          onMaxChatMessageCharactersChange={
            serverSettingsActions
              ? (maximum) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.setMaxChatMessageCharacters(
                      maximum,
                    ),
                  )
              : undefined
          }
          onTransformPreviewRateChange={
            serverSettingsActions
              ? (rate) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.setTransformPreviewRate(rate),
                  )
              : undefined
          }
          onServerUsernameChange={
            serverSettingsActions
              ? (userId, username) =>
                  runServerSettingsAction(() =>
                    serverSettingsActions.updateUsername(userId, username),
                  )
              : undefined
          }
          onExit={() => applicationApi.quit()}
          onLogout={handleLogout}
        />
      ) : null}

      {/* Neither loader outlives the screen it was covering for. */}
      {playSession ? null : preloadLabel ? (
        <CanonicalLoader label={preloadLabel} mode="fullscreen" />
      ) : showSyncLoader && syncingRemote ? (
        <CanonicalLoader
          completedBytes={assetProgress?.completedBytes}
          currentName={assetProgress?.currentName}
          label="Synchronizing campaign assets…"
          mode="fullscreen"
          totalBytes={assetProgress?.totalBytes}
        />
      ) : null}

      <ErrorModal
        isOpen={assetError !== null}
        message={assetError?.message ?? ''}
        title={assetError?.title ?? 'Campaign asset error'}
        onDismiss={() => setAssetError(null)}
      />
    </main>
  );
}
