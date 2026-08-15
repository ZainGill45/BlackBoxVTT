import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import styles from './Dropdown.module.css';

interface DropdownProps {
  accessibleLabel?: string;
  children: ReactNode;
  className?: string;
  closeOnSelect?: boolean;
  disabled?: boolean;
  id?: string;
  label: string;
  panelLabel?: string;
  showIndicator?: boolean;
  title?: string;
}

interface DropdownOptionProps {
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
}

export function Dropdown({
  accessibleLabel,
  children,
  className,
  closeOnSelect = true,
  disabled = false,
  id,
  label,
  panelLabel,
  showIndicator = true,
  title,
}: DropdownProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const controlLabel = accessibleLabel ?? label;

  /**
   * Pins the open panel to its trigger in viewport coordinates.
   *
   * An absolutely positioned panel is still part of its scroll container's
   * content, so inside a scrolling modal the last row's panel grows the modal
   * instead of floating over it. Fixed positioning takes the panel out of that
   * flow entirely, which means the offsets have to be measured rather than
   * inherited. The panel is never narrower than the control it belongs to.
   */
  const position = useCallback(() => {
    const details = detailsRef.current;
    const panel = panelRef.current;
    const summary = details?.querySelector('summary');
    if (!details?.open || !panel || !summary) return;
    const trigger = summary.getBoundingClientRect();
    /* Handed to the stylesheet rather than applied here, so the floor it is
       measured against stays a token. A fixed panel is laid out against the
       window, so leaving its width to shrink-to-fit would let a panel whose
       columns are fractional stretch across the whole of it. */
    panel.style.setProperty('--dropdown-trigger-width', `${trigger.width}px`);
    /* Flips above the trigger when there is no room below it, so a control near
       the bottom of the window still shows its options. The gap itself stays in
       the stylesheet, applied as a translation in whichever direction. */
    const below = window.innerHeight - trigger.bottom;
    const above = trigger.top > below && below < panel.offsetHeight;
    panel.dataset.placement = above ? 'above' : 'below';
    panel.style.top = above
      ? `${trigger.top - panel.offsetHeight}px`
      : `${trigger.bottom}px`;
    /* Matches the shared context menu, which keeps the same margin from the
       window edge rather than letting a panel run off it. */
    const edge = 8;
    panel.style.left = `${Math.max(
      edge,
      Math.min(trigger.left, window.innerWidth - panel.offsetWidth - edge),
    )}px`;
  }, []);

  useEffect(() => {
    const reposition = () => position();
    /* Capture, because the scroll that moves the trigger is usually a panel
       inside the page rather than the window itself. */
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [position]);

  return (
    <details
      ref={detailsRef}
      onToggle={() => position()}
      className={[styles.dropdown, className].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof HTMLElement) ||
          !event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary
        aria-disabled={disabled || undefined}
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
        {showIndicator
          ? <ChevronDown aria-hidden size="0.9rem" strokeWidth={1.7} />
          : null}
      </summary>
      <div
        ref={panelRef}
        aria-label={panelLabel ?? `${controlLabel} options`}
        className={styles.panel}
        role="group"
        onClick={(event) => {
          if (
            closeOnSelect &&
            event.target instanceof Element &&
            event.target.closest('button')
          ) {
            detailsRef.current!.open = false;
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function DropdownOption({
  active,
  disabled = false,
  icon,
  label,
  onSelect,
}: DropdownOptionProps) {
  return (
    <button
      aria-pressed={active}
      className={icon ? `${styles.option} ${styles.optionWithIcon}` : styles.option}
      disabled={disabled}
      type="button"
      onClick={onSelect}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
