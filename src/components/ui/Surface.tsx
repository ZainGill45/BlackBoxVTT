import type { HTMLAttributes } from 'react';
import styles from './Surface.module.css';

export function Surface({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.surface, className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
