import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './FormField.module.css';

interface FormFieldProps {
  children: ReactNode;
  className?: string;
  error?: ReactNode;
  help?: ReactNode;
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
  error,
  help,
  htmlFor,
  label,
  showLabel = false,
}: FormFieldProps) {
  const generatedId = useId();
  const helpId = help ? `${generatedId}-help` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const descriptionId = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  type DescribedControl = ReactElement<{
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true';
  }>;
  const child = children as DescribedControl;
  const control = isValidElement(children)
    ? cloneElement(child, {
        'aria-describedby': [
          child.props['aria-describedby'],
          descriptionId,
        ].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : child.props['aria-invalid'],
      })
    : children;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label
        className={showLabel ? styles.visibleLabel : styles.label}
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {control}
      {help ? <span className={styles.help} id={helpId}>{help}</span> : null}
      {error ? (
        <span className={styles.error} id={errorId} role="alert">{error}</span>
      ) : null}
    </div>
  );
}
