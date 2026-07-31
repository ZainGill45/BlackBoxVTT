import { useState } from 'react';
import { Surface } from '../../components/ui/Surface';
import { Tabs, type TabOption } from '../../components/ui/Tabs';
import { CreateCampaignForm } from './CreateCampaignForm';
import { JoinCampaignFlow } from './JoinCampaignFlow';
import { SavedEntryList, type SavedEntryViewModel } from './SavedEntryList';
import type {
  ConnectionScreenProps,
  ConnectionTab,
  CreateCampaignDraft,
  JoinCampaignDraft,
} from './types';
import {
  DELETE_CONFIRMATION_TIMEOUT_MS,
  useDeleteConfirmation,
} from './useDeleteConfirmation';
import styles from './ConnectionScreen.module.css';

export { DELETE_CONFIRMATION_TIMEOUT_MS };

const tabs: readonly TabOption<ConnectionTab>[] = [
  {
    id: 'join',
    label: 'Join Campaign',
    panelId: 'join-campaign-panel',
  },
  {
    id: 'create',
    label: 'Create Campaign',
    panelId: 'create-campaign-panel',
  },
];

const initialJoinDraft: JoinCampaignDraft = {
  host: '',
  port: '',
};

const initialCreateDraft: CreateCampaignDraft = {
  name: '',
};

const updatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatUpdatedAt(updatedAt: string): string {
  return `Updated ${updatedAtFormatter.format(new Date(updatedAt))}`;
}

export function ConnectionScreen({
  campaignLoadError,
  campaignLoadState,
  campaigns,
  connectionNotice,
  networkApi,
  onCreate,
  onDeleteCampaign,
  onOpenCampaign,
  onRemoteAuthenticated,
}: ConnectionScreenProps) {
  const [activeTab, setActiveTab] = useState<ConnectionTab>('join');
  const [joinDraft, setJoinDraft] =
    useState<JoinCampaignDraft>(initialJoinDraft);
  const [createDraft, setCreateDraft] =
    useState<CreateCampaignDraft>(initialCreateDraft);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [campaignMutationError, setCampaignMutationError] = useState<
    string | null
  >(null);
  const {
    clear: clearDeleteConfirmation,
    pendingId: pendingDeleteId,
    request: requestDeleteConfirmation,
  } = useDeleteConfirmation();

  const handleTabChange = (nextTab: ConnectionTab) => {
    if (nextTab !== activeTab) {
      clearDeleteConfirmation();
      setCampaignMutationError(null);
    }

    setActiveTab(nextTab);
  };

  const handleCreate = async (draft: CreateCampaignDraft) => {
    setIsCreating(true);
    setCampaignMutationError(null);

    try {
      const result = await onCreate(draft);

      if (result.ok) {
        setCreateDraft(initialCreateDraft);
      } else {
        setCampaignMutationError(result.error.message);
      }
    } catch {
      setCampaignMutationError('Campaign could not be created.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!requestDeleteConfirmation(id)) {
      return;
    }

    setDeletingId(id);
    setCampaignMutationError(null);

    try {
      const result = await onDeleteCampaign(id);

      if (!result.ok) {
        setCampaignMutationError(result.error.message);
      }
    } catch {
      setCampaignMutationError('Campaign could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  const campaignEntries: readonly SavedEntryViewModel[] = campaigns.map(
    (campaign) => ({
      detail: formatUpdatedAt(campaign.updatedAt),
      id: campaign.id,
      title: campaign.name,
    }),
  );

  const statusMessage =
    campaignMutationError ??
    (campaignLoadState === 'loading'
      ? 'Loading campaigns…'
      : campaignLoadState === 'error'
        ? campaignLoadError
        : null);
  const statusIsError =
    campaignMutationError !== null || campaignLoadState === 'error';

  return (
    <Surface className={styles.panel}>
      <Tabs
        activeId={activeTab}
        ariaLabel="Campaign connection options"
        items={tabs}
        onChange={handleTabChange}
      />

      {activeTab === 'join' ? (
        <section
          id="join-campaign-panel"
          className={styles.panelBody}
          role="tabpanel"
          aria-labelledby="join-campaign-panel-tab"
        >
          <JoinCampaignFlow
            connectionNotice={connectionNotice}
            draft={joinDraft}
            networkApi={networkApi}
            onAuthenticated={onRemoteAuthenticated}
            onChange={setJoinDraft}
          />
        </section>
      ) : (
        <section
          id="create-campaign-panel"
          className={styles.panelBody}
          role="tabpanel"
          aria-labelledby="create-campaign-panel-tab"
        >
          <CreateCampaignForm
            draft={createDraft}
            isSubmitting={isCreating}
            onChange={(draft) => {
              setCreateDraft(draft);
              setCampaignMutationError(null);
            }}
            onSubmit={(draft) => {
              void handleCreate(draft);
            }}
          />

          {statusMessage ? (
            <p
              className={styles.status}
              role={statusIsError ? 'alert' : 'status'}
            >
              {statusMessage}
            </p>
          ) : null}

          {campaignLoadState === 'ready' ? (
            <SavedEntryList
              deletingId={deletingId}
              entries={campaignEntries}
              label="Created campaigns"
              pendingDeleteId={pendingDeleteId}
              onDeleteRequest={(id) => {
                void handleDeleteRequest(id);
              }}
              onOpen={onOpenCampaign}
            />
          ) : null}
        </section>
      )}
    </Surface>
  );
}
