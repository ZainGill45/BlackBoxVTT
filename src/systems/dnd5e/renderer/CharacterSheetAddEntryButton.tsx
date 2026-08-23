import type { ButtonHTMLAttributes } from 'react';
import { Button } from '../../../components/ui/Button';
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
    <Button variant="ghost"
      className={[styles.button, className].filter(Boolean).join(' ')}
      type="button"
      {...props}
    >
      {label}
    </Button>
  );
}
