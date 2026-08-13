import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
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
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ children, className, disabled, indeterminate = false, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current!);
    useEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
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
          ref={inputRef}
          aria-checked={indeterminate ? 'mixed' : props['aria-checked']}
          className={styles.input}
          disabled={disabled}
          type="checkbox"
        />
        <span aria-hidden="true" className={styles.control}>
          <svg
            className={styles.checkedIndicator}
            data-checkbox-icon="square"
            fill="none"
            height="0.75rem"
            shapeRendering="crispEdges"
            viewBox="0 0 12 12"
            width="0.75rem"
          >
            <rect fill="currentColor" height="8" width="8" x="2" y="2" />
          </svg>
        </span>
        <span className={styles.label}>{children}</span>
      </label>
    );
  },
);

Checkbox.displayName = 'Checkbox';
