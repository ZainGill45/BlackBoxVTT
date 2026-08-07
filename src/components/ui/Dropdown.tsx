import { ChevronDown } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import styles from './Dropdown.module.css';

interface DropdownProps {
  accessibleLabel?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
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
  disabled = false,
  label,
  panelLabel,
  showIndicator = true,
  title,
}: DropdownProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const controlLabel = accessibleLabel ?? label;

  return (
    <details
      ref={detailsRef}
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
        aria-label={panelLabel ?? `${controlLabel} options`}
        className={styles.panel}
        role="group"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) {
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
