import { forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'default' | 'compact';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      type = 'button',
      variant = 'secondary',
      size = 'default',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={[
        styles.button,
        styles[variant],
        styles[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
