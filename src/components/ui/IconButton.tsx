import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentType,
} from 'react';
import { Button } from './Button';
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
  variant?: 'default' | 'embedded';
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
      variant = 'default',
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      className={[styles.button, className].filter(Boolean).join(' ')}
      title={title}
      variant={variant === 'embedded' ? 'embedded' : 'icon'}
      {...props}
    >
      <Icon aria-hidden size="1.125rem" strokeWidth={1.5} />
    </Button>
  ),
);

IconButton.displayName = 'IconButton';
