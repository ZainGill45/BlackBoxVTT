import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import styles from './FormField.module.css';

interface FormFieldProps {
  children: ReactNode;
  className?: string;
  htmlFor: string;
  label: string;
  /**
   * Labels are screen-reader only by default, because most fields in the app
   * stand alone and carry a placeholder. Dense forms need them on screen.
   */
  showLabel?: boolean;
}

export function FormField({
  children,
  className,
  htmlFor,
  label,
  showLabel = false,
}: FormFieldProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label
        className={showLabel ? styles.visibleLabel : styles.label}
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={[styles.control, className].filter(Boolean).join(' ')}
    {...props}
  />
));

TextInput.displayName = 'TextInput';

export const SelectInput = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <span className={styles.selectShell}>
    <select
      ref={ref}
      className={[styles.control, styles.select, className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </select>
    <span className={styles.selectIndicator} aria-hidden="true" />
  </span>
));

SelectInput.displayName = 'SelectInput';
