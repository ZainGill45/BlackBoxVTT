import { useState } from 'react';
import { Surface } from '../../components/ui/Surface';
import { Tabs, type TabOption } from '../../components/ui/Tabs';
import { isUnavailableCampaignSummary } from '../../shared/campaigns';
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
  onExportCampaign,
  onImportCampaign,
  onOpenCampaign,
  onRemoteAuthenticated,
  onSalvageCampaign,
}: ConnectionScreenProps) {
  const [activeTab, setActiveTab] = useState<ConnectionTab>('join');
  const [joinDraft, setJoinDraft] =
    useState<JoinCampaignDraft>(initialJoinDraft);
  const [createDraft, setCreateDraft] =
    useState<CreateCampaignDraft>(initialCreateDraft);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [salvagingId, setSalvagingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [campaignMutationError, setCampaignMutationError] = useState<
    string | null
  >(null);
  const [campaignMutationNotice, setCampaignMutationNotice] = useState<
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
      setCampaignMutationNotice(null);
    }

    setActiveTab(nextTab);
  };

  const handleCreate = async (draft: CreateCampaignDraft) => {
    setIsCreating(true);
    setCampaignMutationError(null);
    setCampaignMutationNotice(null);

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
    setCampaignMutationNotice(null);

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

  const handleExport = async (id: string) => {
    setExportingId(id);
    setCampaignMutationError(null);
    setCampaignMutationNotice(null);

    try {
      const result = await onExportCampaign(id);
      if (result.ok) {
        if (result.value) {
          setCampaignMutationNotice(`Exported ${result.value.fileName}.`);
        }
      } else {
        setCampaignMutationError(result.error.message);
      }
    } catch {
      setCampaignMutationError('Campaign could not be exported.');
    } finally {
      setExportingId(null);
    }
  };

  const handleSalvage = async (id: string) => {
    setSalvagingId(id);
    setCampaignMutationError(null);
    setCampaignMutationNotice(null);

    try {
      const result = await onSalvageCampaign(id);
      if (result.ok) {
        const { campaign, report } = result.value;
        setCampaignMutationNotice(
          `Salvaged ${campaign.name} from campaign format ` +
            `${report.detectedFormat}. ${report.warnings.join(' ')}`.trimEnd(),
        );
      } else {
        setCampaignMutationError(result.error.message);
      }
    } catch {
      setCampaignMutationError('Campaign could not be salvaged.');
    } finally {
      setSalvagingId(null);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    setCampaignMutationError(null);
    setCampaignMutationNotice(null);

    try {
      const result = await onImportCampaign();
      if (result.ok) {
        if (result.value) {
          const warnings = result.value.report.warnings;
          setCampaignMutationNotice(
            warnings.length === 0
              ? `Imported ${result.value.campaign.name}.`
              : `Imported ${result.value.campaign.name}. ${warnings.join(' ')}`,
          );
        }
      } else {
        setCampaignMutationError(result.error.message);
      }
    } catch {
      setCampaignMutationError('Campaign could not be imported.');
    } finally {
      setIsImporting(false);
    }
  };

  const campaignEntries: readonly SavedEntryViewModel[] = campaigns.map(
    (campaign) => {
      const unavailable = isUnavailableCampaignSummary(campaign);
      return {
        detail: unavailable
          ? 'Outdated or invalid campaign data. Delete to remove.'
          : formatUpdatedAt(campaign.updatedAt),
        id: campaign.id,
        title: campaign.name,
        unavailable,
      };
    },
  );

  const statusMessage =
    campaignMutationError ??
    campaignMutationNotice ??
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
            isImporting={isImporting}
            isSubmitting={isCreating}
            onChange={(draft) => {
              setCreateDraft(draft);
              setCampaignMutationError(null);
              setCampaignMutationNotice(null);
            }}
            onImport={() => {
              void handleImport();
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
              exportingId={exportingId}
              label="Created campaigns"
              pendingDeleteId={pendingDeleteId}
              salvagingId={salvagingId}
              onDeleteRequest={(id) => {
                void handleDeleteRequest(id);
              }}
              onExport={(id) => {
                void handleExport(id);
              }}
              onOpen={onOpenCampaign}
              onSalvage={(id) => {
                void handleSalvage(id);
              }}
            />
          ) : null}
        </section>
      )}
    </Surface>
  );
}
