import type { ReactNode } from 'react';
import { TextInput } from '../../../components/ui/FormField';
import styles from './RollEditorControls.module.css';

export function RollEditorField({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={[styles.editorField, className].filter(Boolean).join(' ')}>
      <span className={styles.editorLabel}>{label}</span>
      {children}
    </div>
  );
}

export function RollNumericField({
  accessibleLabel,
  maximum,
  minimum,
  onCommit,
  readOnly = false,
  value,
}: {
  accessibleLabel: string;
  maximum?: number;
  minimum?: number;
  onCommit: (value: number) => void;
  readOnly?: boolean;
  value: number;
}) {
  return (
    <TextInput
      aria-label={accessibleLabel}
      defaultValue={String(value)}
      inputMode="numeric"
      key={value}
      maxLength={128}
      readOnly={readOnly}
      onBlur={(event) => {
        const draft = event.currentTarget.value;
        const parsed = /^[+-]?\d+$/u.test(draft.trim())
          ? Number(draft.trim())
          : Number.NaN;
        if (
          Number.isSafeInteger(parsed) &&
          (minimum === undefined || parsed >= minimum) &&
          (maximum === undefined || parsed <= maximum)
        ) {
          onCommit(parsed);
        } else {
          event.currentTarget.value = String(value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
