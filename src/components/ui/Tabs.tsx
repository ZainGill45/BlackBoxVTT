import { useRef, type KeyboardEvent } from 'react';
import styles from './Tabs.module.css';

export interface TabOption<T extends string> {
  id: T;
  label: string;
  panelId: string;
}

interface TabsProps<T extends string> {
  activeId: T;
  ariaLabel: string;
  items: readonly TabOption<T>[];
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({
  activeId,
  ariaLabel,
  items,
  onChange,
}: TabsProps<T>) {
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const activateTab = (index: number) => {
    const nextTab = items[index];

    if (!nextTab) {
      return;
    }

    onChange(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = items.findIndex((item) => item.id === activeId);
    let nextIndex: number | undefined;

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(nextIndex);
  };

  return (
    <div className={styles.list} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            id={`${item.panelId}-tab`}
            type="button"
            role="tab"
            aria-controls={item.panelId}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.id)}
            onKeyDown={handleKeyDown}
          >
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
