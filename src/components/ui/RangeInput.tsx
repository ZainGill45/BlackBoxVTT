import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './RangeInput.module.css';

type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(
  ({ className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      className={[styles.range, className].filter(Boolean).join(' ')}
      type="range"
    />
  ),
);

RangeInput.displayName = 'RangeInput';
