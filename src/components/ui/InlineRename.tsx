import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './InlineRename.module.css';

interface InlineRenameProps {
  accessibleLabel: string;
  detail?: ReactNode;
  disabled?: boolean;
  maxLength: number;
  onRename: (value: string) => Promise<boolean>;
  value: string;
}

export function InlineRename({
  accessibleLabel,
  detail,
  disabled = false,
  maxLength,
  onRename,
  value,
}: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  const cancelPending = useRef(false);

  const commit = async () => {
    if (cancelPending.current) {
      cancelPending.current = false;
      return;
    }
    if (draft === value) return;
    const saved = await onRename(draft);
    if (!saved) setDraft(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPending.current = true;
      setDraft(value);
      event.currentTarget.blur();
    }
  };

  return (
    <div className={styles.copy}>
      <input
        aria-label={accessibleLabel}
        disabled={disabled}
        maxLength={maxLength}
        value={draft}
        onBlur={() => void commit()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}
