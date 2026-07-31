import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
} from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  icon: ComponentType<{
    'aria-hidden'?: boolean;
    size?: number | string;
    strokeWidth?: number | string;
  }>;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      active = false,
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
      aria-label={label}
      className={[styles.button, className].filter(Boolean).join(' ')}
      data-active={active}
      title={title}
      {...props}
    >
      <Icon aria-hidden size="1.125rem" strokeWidth={1.5} />
    </button>
  ),
);

IconButton.displayName = 'IconButton';
