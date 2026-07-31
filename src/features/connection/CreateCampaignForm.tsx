import type { FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField, TextInput } from '../../components/ui/FormField';
import type { CreateCampaignDraft } from './types';
import styles from './ConnectionScreen.module.css';

interface CreateCampaignFormProps {
  draft: CreateCampaignDraft;
  isSubmitting: boolean;
  onChange: (draft: CreateCampaignDraft) => void;
  onSubmit: (draft: CreateCampaignDraft) => void;
}

export function CreateCampaignForm({
  draft,
  isSubmitting,
  onChange,
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
            disabled={isSubmitting}
            required
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
          />
        </FormField>

        <Button
          className={styles.formAction}
          type="submit"
          variant="primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
