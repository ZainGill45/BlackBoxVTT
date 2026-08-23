import { ChevronDown } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from './Button';
import styles from './Dropdown.module.css';

export type DropdownMode = 'single' | 'multiple' | 'action';
export type DropdownAlign = 'left' | 'center' | 'right';
export type DropdownDensity = 'default' | 'compact' | 'inline';
export type DropdownHeight = 'default' | 'fill';
export type DropdownSurface = 'default' | 'borderless' | 'underline';
export type DropdownTone = 'default' | 'muted';

interface DropdownProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  accessibleLabel?: string;
  align?: DropdownAlign;
  children: ReactNode;
  className?: string;
  density?: DropdownDensity;
  disabled?: boolean;
  height?: DropdownHeight;
  id?: string;
  label: string;
  mode?: DropdownMode;
  panelLabel?: string;
  showIndicator?: boolean;
  surface?: DropdownSurface;
  title?: string;
  tone?: DropdownTone;
}

interface DropdownOptionProps {
  active?: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
  title?: string;
}

const DropdownModeContext = createContext<DropdownMode>('single');

function enabledOptions(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      'button[data-dropdown-option]:not(:disabled)',
    ),
  );
}

export function Dropdown({
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  accessibleLabel,
  align = 'left',
  children,
  className,
  density = 'default',
  disabled = false,
  height = 'default',
  id,
  label,
  mode = 'single',
  panelLabel,
  showIndicator = true,
  surface = 'default',
  title,
  tone = 'default',
}: DropdownProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ query: '', timer: 0 });
  const [open, setOpen] = useState(false);
  const controlLabel = accessibleLabel ?? label;

  const position = useCallback(() => {
    const details = detailsRef.current;
    const panel = panelRef.current;
    const summary = details?.querySelector('summary');
    if (!details?.open || !panel || !summary) return;
    const trigger = summary.getBoundingClientRect();
    panel.style.setProperty('--dropdown-trigger-width', `${trigger.width}px`);
    const below = window.innerHeight - trigger.bottom;
    const above = trigger.top > below && below < panel.offsetHeight;
    panel.dataset.placement = above ? 'above' : 'below';
    panel.style.top = above
      ? `${trigger.top - panel.offsetHeight}px`
      : `${trigger.bottom}px`;
    const edge = 8;
    panel.style.left = `${Math.max(
      edge,
      Math.min(trigger.left, window.innerWidth - panel.offsetWidth - edge),
    )}px`;
  }, []);

  const close = useCallback((returnFocus = false) => {
    const details = detailsRef.current;
    if (!details) return;
    details.open = false;
    setOpen(false);
    if (returnFocus) details.querySelector<HTMLElement>('summary')?.focus();
  }, []);

  const openAndFocus = (edge: 'first' | 'last' | 'selected' = 'selected') => {
    const details = detailsRef.current;
    if (!details || disabled) return;
    details.open = true;
    setOpen(true);
    window.requestAnimationFrame(() => {
      position();
      const panel = panelRef.current;
      if (!panel) return;
      const options = enabledOptions(panel);
      const selected = panel.querySelector<HTMLButtonElement>(
        'button[data-dropdown-option][aria-selected="true"], button[data-dropdown-option][aria-checked="true"]',
      );
      (edge === 'first'
        ? options[0]
        : edge === 'last'
          ? options.at(-1)
          : selected ?? options[0])?.focus();
    });
  };

  useEffect(() => {
    const typeahead = typeaheadRef.current;
    const reposition = () => position();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.clearTimeout(typeahead.timer);
    };
  }, [position]);

  const handleKeyboard = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const panel = panelRef.current;
    const target = event.target as HTMLElement;
    const isTrigger = target.tagName === 'SUMMARY';

    if (event.key === 'Escape' && detailsRef.current?.open) {
      event.preventDefault();
      close(true);
      return;
    }

    if (isTrigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last');
      return;
    }

    if (!panel?.contains(target)) return;
    const options = enabledOptions(panel);
    const index = options.indexOf(target as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = options[(index + 1) % options.length];
    else if (event.key === 'ArrowUp') {
      next = options[(index - 1 + options.length) % options.length];
    } else if (event.key === 'Home') next = options[0];
    else if (event.key === 'End') next = options.at(-1);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      window.clearTimeout(typeaheadRef.current.timer);
      typeaheadRef.current.query += event.key.toLocaleLowerCase();
      const query = typeaheadRef.current.query;
      next = options.find((option) =>
        option.textContent?.trim().toLocaleLowerCase().startsWith(query),
      );
      typeaheadRef.current.timer = window.setTimeout(() => {
        typeaheadRef.current.query = '';
      }, 500);
    } else {
      return;
    }
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <DropdownModeContext.Provider value={mode}>
      <details
        ref={detailsRef}
        className={[
          styles.dropdown,
          align === 'center'
            ? styles.alignCenter
            : align === 'right'
              ? styles.alignRight
              : undefined,
          density === 'compact'
            ? styles.densityCompact
            : density === 'inline'
              ? styles.densityInline
              : undefined,
          height === 'fill' ? styles.heightFill : undefined,
          surface === 'borderless'
            ? styles.surfaceBorderless
            : surface === 'underline'
              ? styles.surfaceUnderline
              : undefined,
          tone === 'muted' ? styles.toneMuted : undefined,
          showIndicator ? undefined : styles.withoutIndicator,
          className,
        ].filter(Boolean).join(' ')}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof HTMLElement) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            close();
          }
        }}
        onKeyDown={handleKeyboard}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          setOpen(nextOpen);
          if (nextOpen) position();
        }}
      >
        <summary
          aria-describedby={ariaDescribedBy}
          aria-disabled={disabled || undefined}
          aria-expanded={open}
          aria-haspopup={mode === 'action' ? 'menu' : 'listbox'}
          aria-invalid={ariaInvalid}
          aria-label={controlLabel}
          id={id}
          role="button"
          tabIndex={disabled ? -1 : undefined}
          title={title ?? controlLabel}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (disabled && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
            }
          }}
        >
          <span>{label}</span>
          {showIndicator ? (
            <ChevronDown aria-hidden size="0.9rem" strokeWidth={1.7} />
          ) : null}
        </summary>
        <div
          ref={panelRef}
          aria-label={panelLabel ?? `${controlLabel} options`}
          aria-multiselectable={mode === 'multiple' || undefined}
          className={styles.panel}
          role={mode === 'action' ? 'menu' : 'listbox'}
          onClick={(event) => {
            if (
              mode !== 'multiple' &&
              event.target instanceof Element &&
              event.target.closest('button[data-dropdown-option]')
            ) {
              close(true);
            }
          }}
        >
          {children}
        </div>
      </details>
    </DropdownModeContext.Provider>
  );
}

export function DropdownOption({
  active,
  children,
  className,
  disabled = false,
  icon,
  label,
  onSelect,
  title,
}: DropdownOptionProps) {
  const mode = useContext(DropdownModeContext);
  const role = mode === 'action'
    ? active === undefined
      ? 'menuitem'
      : 'menuitemcheckbox'
    : 'option';

  return (
    <Button
      align="left"
      aria-checked={role === 'menuitemcheckbox' ? Boolean(active) : undefined}
      aria-label={label}
      aria-selected={role === 'option' ? Boolean(active) : undefined}
      className={[
        styles.option,
        icon ? styles.optionWithIcon : undefined,
        className,
      ].filter(Boolean).join(' ')}
      data-dropdown-option
      disabled={disabled}
      role={role}
      tabIndex={-1}
      title={title}
      variant="list"
      onClick={onSelect}
    >
      {children ?? (
        <>
          {icon}
          <span>{label}</span>
        </>
      )}
    </Button>
  );
}
