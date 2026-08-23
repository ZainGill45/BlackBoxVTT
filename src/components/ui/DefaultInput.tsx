import {
  forwardRef,
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './DefaultInput.module.css';

type SharedProps = {
  align?: 'left' | 'center' | 'right';
  className?: string;
  density?: 'default' | 'compact';
  fillHeight?: boolean;
  font?: 'default' | 'mono';
  endAdornmentWidth?: 'default' | 'wide';
  hasEndAdornment?: boolean;
  hasStartAdornment?: boolean;
  surface?: 'default' | 'borderless';
};

type DefaultInputElementOptions = Pick<
  SharedProps,
  'align' | 'className' | 'density' | 'endAdornmentWidth' | 'fillHeight' | 'font'
  | 'hasEndAdornment' | 'hasStartAdornment' | 'surface'
>;

function defaultInputClassName({
  align = 'left',
  className,
  density = 'default',
  endAdornmentWidth = 'default',
  fillHeight = false,
  font = 'default',
  hasEndAdornment = false,
  hasStartAdornment = false,
  surface = 'default',
}: DefaultInputElementOptions): string {
  return [
    styles.control,
    styles[align],
    styles[density],
    styles[font],
    hasEndAdornment ? styles.endAdornment : undefined,
    hasEndAdornment && endAdornmentWidth === 'wide' ? styles.wideEndAdornment : undefined,
    hasStartAdornment ? styles.startAdornment : undefined,
    fillHeight ? styles.fill : undefined,
    styles[surface],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Gives imperative DOM editors the canonical textarea surface and states. */
export function createDefaultTextareaElement(
  options: DefaultInputElementOptions = {},
): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.className = defaultInputClassName(options);
  return textarea;
}

export type DefaultInputProps =
  | (SharedProps &
      Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'style'> & {
        as?: 'input';
      })
  | (SharedProps &
      Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'style'> & {
        as: 'textarea';
      });

export const DefaultInput = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  DefaultInputProps
>(function DefaultInput(
  {
    align = 'left',
    as = 'input',
    className,
    density = 'default',
    endAdornmentWidth = 'default',
    fillHeight = false,
    font = 'default',
    hasEndAdornment = false,
    hasStartAdornment = false,
    surface = 'default',
    ...props
  },
  ref,
) {
  const controlClassName = defaultInputClassName({
    align,
    className,
    density,
    endAdornmentWidth,
    fillHeight,
    font,
    hasEndAdornment,
    hasStartAdornment,
    surface,
  });

  if (as === 'textarea') {
    return (
      <textarea
        {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        ref={ref as Ref<HTMLTextAreaElement>}
        className={controlClassName}
      />
    );
  }

  return (
    <input
      {...(props as InputHTMLAttributes<HTMLInputElement>)}
      ref={ref as Ref<HTMLInputElement>}
      className={controlClassName}
    />
  );
});
