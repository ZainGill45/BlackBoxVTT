import type { InputHTMLAttributes } from 'react';
import styles from './InlineInput.module.css';

export function InlineInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[styles.input, className].filter(Boolean).join(' ')}
    />
  );
}
