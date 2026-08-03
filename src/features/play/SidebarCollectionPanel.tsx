import { Plus, Search, X } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Collapsible } from '../../components/ui/Collapsible';
import { IconButton } from '../../components/ui/IconButton';
import styles from './SidebarCollectionPanel.module.css';

type SidebarCollectionIcon = ComponentType<{
  'aria-hidden'?: boolean;
  size?: number | string;
  strokeWidth?: number | string;
}>;

interface SidebarCollectionPanelProps {
  addLabel: string;
  children?: ReactNode;
  clearLabel: string;
  emptyIcon: SidebarCollectionIcon;
  emptyIconId: string;
  onAdd: () => void;
  onQueryChange: (query: string) => void;
  query: string;
  searchLabel: string;
  searchPlaceholder: string;
  showEmpty: boolean;
}

export function SidebarCollectionPanel({
  addLabel,
  children,
  clearLabel,
  emptyIcon: EmptyIcon,
  emptyIconId,
  onAdd,
  onQueryChange,
  query,
  searchLabel,
  searchPlaceholder,
  showEmpty,
}: SidebarCollectionPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search aria-hidden size="1rem" />
          <span className="sr-only">{searchLabel}</span>
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onQueryChange('');
              }
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={() => onQueryChange('')}
            >
              <X aria-hidden size="1rem" />
            </button>
          ) : null}
        </label>
        <IconButton icon={Plus} label={addLabel} onClick={onAdd} />
      </div>

      <div className={styles.groups}>
        {children}
        {showEmpty ? (
          <div className={styles.emptyIcon} data-sidebar-icon={emptyIconId}>
            <EmptyIcon aria-hidden size="5rem" strokeWidth={1} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SidebarCollectionGroupProps {
  children: ReactNode;
  expanded: boolean;
  label: string;
  onExpandedChange: (expanded: boolean) => void;
}

export function SidebarCollectionGroup({
  children,
  expanded,
  label,
  onExpandedChange,
}: SidebarCollectionGroupProps) {
  return (
    <Collapsible
      className={styles.group}
      contentClassName={styles.groupContent}
      expanded={expanded}
      label={label}
      onExpandedChange={onExpandedChange}
    >
      {children}
    </Collapsible>
  );
}
