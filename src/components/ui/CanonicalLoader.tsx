import styles from './CanonicalLoader.module.css';

interface CanonicalLoaderProps {
  completedBytes?: number;
  currentName?: string;
  label: string;
  mode?: 'fullscreen' | 'inline';
  totalBytes?: number | null;
}

export function CanonicalLoader({
  completedBytes = 0,
  currentName,
  label,
  mode = 'inline',
  totalBytes = null,
}: CanonicalLoaderProps) {
  const determinate = totalBytes !== null;
  const percentage =
    determinate && totalBytes > 0
      ? Math.min(100, Math.round((completedBytes / totalBytes) * 100))
      : determinate
        ? 100
        : null;

  return (
    <div
      className={styles.loader}
      data-mode={mode}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.surface}>
        <div className={styles.bars} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>{label}</strong>
        {currentName ? <span className={styles.current}>{currentName}</span> : null}
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
        {percentage !== null ? <span>{percentage}%</span> : null}
      </div>
    </div>
  );
}
