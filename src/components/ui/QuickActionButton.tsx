import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
} from 'react';
import styles from './QuickActionButton.module.css';

interface QuickActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ComponentType<{
    'aria-hidden'?: boolean;
    size?: number | string;
    strokeWidth?: number | string;
  }>;
  label: string;
}

export const QuickActionButton = forwardRef<
  HTMLButtonElement,
  QuickActionButtonProps
>(
  (
    {
      className,
      icon: Icon,
      label,
      title = label,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={[styles.button, className].filter(Boolean).join(' ')}
      title={title}
      {...props}
    >
      <Icon aria-hidden size="1rem" strokeWidth={1.75} />
      <span className={styles.label}>{label}</span>
    </button>
  ),
);

QuickActionButton.displayName = 'QuickActionButton';
