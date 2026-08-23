import { forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'text'
  | 'ghost'
  | 'toolbar'
  | 'icon'
  | 'embedded'
  | 'list';
export type ButtonSize = 'default' | 'compact';
export type ButtonAlignment = 'left' | 'center' | 'right';
export type ButtonLayout = 'inline' | 'flow' | 'block' | 'stack' | 'spread';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  align?: ButtonAlignment;
  layout?: ButtonLayout;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface ButtonElementOptions {
  align?: ButtonAlignment;
  className?: string;
  layout?: ButtonLayout;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

function buttonClassName({
  align = 'center',
  className,
  layout = 'inline',
  size = 'default',
  variant = 'secondary',
}: ButtonElementOptions): string {
  return [
    styles.button,
    styles[variant],
    styles[size],
    styles[layout],
    styles[`align-${align}`],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Gives imperative DOM surfaces the same root as React-rendered buttons. */
export function createButtonElement(options: ButtonElementOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = buttonClassName(options);
  return button;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      align = 'center',
      className,
      layout = 'inline',
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
      className={buttonClassName({ align, className, layout, size, variant })}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
