import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'children' | 'className' | 'type'
  > {
  children: ReactNode;
  className?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ children, className, disabled, ...props }, ref) => (
    <label
      className={[
        styles.checkbox,
        disabled ? styles.disabled : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        {...props}
        ref={ref}
        className={styles.input}
        disabled={disabled}
        type="checkbox"
      />
      <span aria-hidden="true" className={styles.control}>
        <svg
          className={styles.checkmark}
          data-checkbox-icon="check"
          fill="none"
          height="0.75rem"
          shapeRendering="crispEdges"
          viewBox="0 0 12 12"
          width="0.75rem"
        >
          <path
            d="M1.5 6.5 4.5 9.5 10.5 2.5"
            stroke="currentColor"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            strokeWidth="1.5"
          />
        </svg>
      </span>
      <span className={styles.label}>{children}</span>
    </label>
  ),
);

Checkbox.displayName = 'Checkbox';
