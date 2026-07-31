import {
  useRef,
  type ComponentType,
  type KeyboardEvent,
} from 'react';
import { IconButton } from './IconButton';

interface IconTabOption<T extends string> {
  icon: ComponentType<{
    'aria-hidden'?: boolean;
    size?: number | string;
    strokeWidth?: number | string;
  }>;
  id: T;
  label: string;
  panelId: string;
}

interface IconTabsProps<T extends string> {
  activeId: T;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
  items: readonly IconTabOption<T>[];
  onChange: (id: T) => void;
}

export function IconTabs<T extends string>({
  activeId,
  ariaLabel,
  className,
  itemClassName,
  items,
  onChange,
}: IconTabsProps<T>) {
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
    <div className={className} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <IconButton
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            active={isActive}
            aria-controls={item.panelId}
            aria-selected={isActive}
            className={itemClassName}
            icon={item.icon}
            id={`${item.panelId}-tab`}
            label={item.label}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={handleKeyDown}
          />
        );
      })}
    </div>
  );
}
