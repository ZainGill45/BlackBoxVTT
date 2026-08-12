import {
  nextDnd5eSkillTraining,
  type Dnd5eSkillTraining,
} from '../characterData';
import styles from './CharacterSheetModal.module.css';

const SKILL_TRAINING_LABELS = {
  expertise: 'Expertise',
  proficient: 'Proficient',
  untrained: 'Untrained',
} satisfies Record<Dnd5eSkillTraining, string>;

interface CharacterSkillTrainingButtonProps {
  disabled: boolean;
  label: string;
  onChange: (training: Dnd5eSkillTraining) => void;
  training: Dnd5eSkillTraining;
}

export function CharacterSkillTrainingButton({
  disabled,
  label,
  onChange,
  training,
}: CharacterSkillTrainingButtonProps) {
  const nextTraining = nextDnd5eSkillTraining(training);
  return (
    <button
      aria-label={`${label} training: ${SKILL_TRAINING_LABELS[training]}`}
      className={styles.skillTraining}
      data-training={training}
      disabled={disabled}
      title={`Set ${label} training to ${SKILL_TRAINING_LABELS[nextTraining]}`}
      type="button"
      onClick={() => onChange(nextTraining)}
    >
      <svg
        aria-hidden="true"
        className={styles.skillTrainingIcon}
        viewBox="0 0 12 12"
      >
        <circle
          className={styles.skillTrainingOuter}
          cx="6"
          cy="6"
          r="4.5"
        />
        <circle
          className={styles.skillTrainingInner}
          cx="6"
          cy="6"
          r="2"
        />
      </svg>
    </button>
  );
}
