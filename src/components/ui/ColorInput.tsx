import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './ColorInput.module.css';

type ColorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const ColorInput = forwardRef<HTMLInputElement, ColorInputProps>(
  ({ className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      className={[styles.input, className].filter(Boolean).join(' ')}
      type="color"
    />
  ),
);

ColorInput.displayName = 'ColorInput';
