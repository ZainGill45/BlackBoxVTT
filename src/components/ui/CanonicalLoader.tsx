import styles from './CanonicalLoader.module.css';

interface CanonicalLoaderProps {
  completedBytes?: number;
  completedItems?: number;
  currentName?: string;
  label: string;
  mode?: 'fullscreen' | 'inline';
  totalBytes?: number | null;
  totalItems?: number;
}

export function CanonicalLoader({
  completedBytes = 0,
  completedItems,
  currentName,
  label,
  mode = 'inline',
  totalBytes = null,
  totalItems,
}: CanonicalLoaderProps) {
  const byteDeterminate = totalBytes !== null && totalBytes > 0;
  const itemDeterminate =
    completedItems !== undefined && totalItems !== undefined && totalItems > 0;
  const determinate = byteDeterminate || itemDeterminate || totalBytes === 0;
  const percentage =
    byteDeterminate
      ? Math.min(100, Math.round((completedBytes / totalBytes) * 100))
      : itemDeterminate
        ? Math.min(100, Math.round((completedItems / totalItems) * 100))
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
        {completedItems !== undefined && totalItems !== undefined ? (
          <span>{`${completedItems} of ${totalItems} items`}</span>
        ) : null}
        {byteDeterminate ? (
          <span>{`${formatBytes(completedBytes)} of ${formatBytes(totalBytes)}`}</span>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'] as const;
  let value = bytes / 1024;
  let unit: string = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}
