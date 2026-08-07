import type { FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField, TextInput } from '../../components/ui/FormField';
import type { CreateCampaignDraft } from './types';
import styles from './ConnectionScreen.module.css';

interface CreateCampaignFormProps {
  draft: CreateCampaignDraft;
  isImporting: boolean;
  isSubmitting: boolean;
  onChange: (draft: CreateCampaignDraft) => void;
  onImport: () => void;
  onSubmit: (draft: CreateCampaignDraft) => void;
}

export function CreateCampaignForm({
  draft,
  isImporting,
  isSubmitting,
  onChange,
  onImport,
  onSubmit,
}: CreateCampaignFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.createFields}>
        <FormField htmlFor="campaign-name" label="Campaign name">
          <TextInput
            id="campaign-name"
            name="campaignName"
            type="text"
            maxLength={64}
            placeholder="Enter a campaign name"
            value={draft.name}
            autoComplete="off"
            disabled={isSubmitting || isImporting}
            required
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
          />
        </FormField>

        <Button
          className={styles.formAction}
          type="button"
          variant="secondary"
          disabled={isSubmitting || isImporting}
          onClick={onImport}
        >
          {isImporting ? 'Importingâ€¦' : 'Import'}
        </Button>

        <Button
          className={styles.formAction}
          type="submit"
          variant="primary"
          disabled={isSubmitting || isImporting}
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
