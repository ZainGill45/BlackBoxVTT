import type { InputHTMLAttributes } from 'react';
import styles from './InlineInput.module.css';

type InlineInputPresentation =
  | {
      sizing: 'content';
      surface?: 'borderless' | 'underline';
    }
  | {
      sizing?: 'fill';
      surface: 'borderless' | 'underline';
    };

type InlineInputProps = InputHTMLAttributes<HTMLInputElement> & InlineInputPresentation & {
  align?: 'left' | 'center' | 'right';
  density?: 'default' | 'compact';
  font?: 'default' | 'mono';
  height?: 'default' | 'fill' | 'inset';
};

export function InlineInput({
  align = 'left',
  className,
  density = 'default',
  font = 'default',
  height = 'default',
  size,
  sizing = 'fill',
  surface = 'borderless',
  value,
  ...props
}: InlineInputProps) {
  const contentSize = sizing === 'content' && size === undefined
    ? Math.max(1, String(value ?? props.defaultValue ?? '').length)
    : size;

  return (
    <input
      {...props}
      className={[
        styles.input,
        styles[align],
        density === 'compact' ? styles.densityCompact : undefined,
        styles[font],
        height === 'fill'
          ? styles.heightFill
          : height === 'inset'
            ? styles.heightInset
            : undefined,
        styles[sizing],
        styles[surface],
        className,
      ].filter(Boolean).join(' ')}
      size={contentSize}
      value={value}
    />
  );
}
