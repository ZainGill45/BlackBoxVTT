import styles from './CanonicalLoader.module.css';

interface CanonicalLoaderProps {
  completedItems?: number;
  label: string;
  mode?: 'fullscreen' | 'inline';
  totalItems?: number;
}

export function CanonicalLoader({
  completedItems,
  label,
  mode = 'inline',
  totalItems,
}: CanonicalLoaderProps) {
  const determinate =
    completedItems !== undefined && totalItems !== undefined && totalItems > 0;
  const percentage = determinate
    ? Math.min(100, (completedItems / totalItems) * 100)
    : null;

  return (
    <div
      className={styles.loader}
      data-mode={mode}
      role="status"
      aria-label={label}
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.surface}>
        <div className={styles.bars} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={determinate ? 100 : undefined}
          aria-valuenow={percentage ?? undefined}
        >
          <span
            className={styles.progress}
            data-indeterminate={!determinate}
            style={
              determinate
                ? { width: `${percentage ?? 0}%` }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
