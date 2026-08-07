import { useEffect, useState } from 'react';
import { CanonicalLoader } from '../components/ui/CanonicalLoader';
import { ErrorModal } from '../components/ui/ErrorModal';
import { ConnectionScreen } from '../features/connection/ConnectionScreen';
import type {
  ConnectionScreenProps,
  CreateCampaignDraft,
} from '../features/connection/types';
import { PlayScreen } from '../features/play/PlayScreen';
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
import styles from './App.module.css';

interface AppProps {
  applicationApi?: ApplicationApi;
  assetApi?: AssetApi;
  campaignApi?: CampaignApi;
  journalApi?: JournalApi;
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

  useEffect(() => {
    const removeHostListener = networkApi.onHostStatusChanged(setHostStatus);
    const removeClosedListener = networkApi.onSessionClosed((event) => {
      setPlaySession((current) =>
        current?.source === 'remote' ? null : current,
      );
      setConnectionNotice(event.message);
    });
    void networkApi.getHostStatus().then(setHostStatus);

    return () => {
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

  const handleOpenCampaign = async (id: string): Promise<void> => {
    const campaign = campaigns.find((candidate) => candidate.id === id);

    if (!campaign || isUnavailableCampaignSummary(campaign)) {
      return;
    }

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
    if (!result.ok) {
      setConnectionNotice(result.error.message);
      return;
    }
    await refreshServerSettings(campaign.id);
    setPlaySession(session);
  };

  const refreshServerSettings = async (campaignId: string) => {
    const result = await networkApi.getServerSettings({ campaignId });
    if (result.ok) {
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

  const handleLogout = () => {
    if (playSession?.source === 'local') {
      void networkApi
        .stopHost()
        .then(async () => {
          const result = await campaignApi.list();
          if (result.ok) {
            setCampaigns(sortCampaigns(result.value));
          }
        })
        .catch(() => undefined);
    } else if (playSession?.source === 'remote') {
      void networkApi.disconnect();
    }
    setPlaySession(null);
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
          onOpenCampaign={handleOpenCampaign}
          onRemoteAuthenticated={(session) => {
            setConnectionNotice(null);
            setAssetProgress(null);
            setShowSyncLoader(false);
            setSyncingRemote(true);
            void assetApi
              .prepareRemote({ campaignId: session.campaignId })
              .then((result) => {
                if (result.ok) {
                  setPlaySession(session);
                } else {
                  setAssetError({
                    ...result.error,
                    campaignId: session.campaignId,
                    title: 'Campaign asset synchronization failed',
                  });
                }
              })
              .catch(() => {
                setAssetError({
                  campaignId: session.campaignId,
                  code: 'sync_error',
                  message: 'Campaign assets could not be synchronized.',
                  title: 'Campaign asset synchronization failed',
                });
              })
              .finally(() => {
                setSyncingRemote(false);
                setShowSyncLoader(false);
              });
          }}
        />
      </section>

      {playSession ? (
        <PlayScreen
          applicationApi={applicationApi}
          assetApi={assetApi}
          networkApi={networkApi}
          journalApi={journalApi}
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

      {showSyncLoader && syncingRemote ? (
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
