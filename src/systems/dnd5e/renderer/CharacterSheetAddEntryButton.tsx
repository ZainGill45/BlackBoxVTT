import type { ButtonHTMLAttributes } from 'react';
import styles from './CharacterSheetAddEntryButton.module.css';

interface CharacterSheetAddEntryButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  label: string;
}

export function CharacterSheetAddEntryButton({
  className,
  label,
  ...props
}: CharacterSheetAddEntryButtonProps) {
  return (
    <button
      className={[styles.button, className].filter(Boolean).join(' ')}
      type="button"
      {...props}
    >
      {label}
    </button>
  );
}
