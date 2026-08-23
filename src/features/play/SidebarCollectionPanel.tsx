import { Plus } from 'lucide-react';
import type {
  ComponentType,
  MouseEventHandler,
  ReactNode,
} from 'react';
import { Collapsible } from '../../components/ui/Collapsible';
import { IconButton } from '../../components/ui/IconButton';
import { SearchInput } from '../../components/ui/SearchInput';
import styles from './SidebarCollectionPanel.module.css';

type SidebarCollectionIcon = ComponentType<{
  'aria-hidden'?: boolean;
  size?: number | string;
  strokeWidth?: number | string;
}>;

interface SidebarCollectionPanelProps {
  addDisabled?: boolean;
  addHasPopup?: 'menu';
  addLabel: string;
  children?: ReactNode;
  clearLabel: string;
  emptyIcon: SidebarCollectionIcon;
  emptyIconId: string;
  onAdd: MouseEventHandler<HTMLButtonElement>;
  onQueryChange: (query: string) => void;
  query: string;
  searchLabel: string;
  searchPlaceholder: string;
  showEmpty: boolean;
}

export function SidebarCollectionPanel({
  addDisabled = false,
  addHasPopup,
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
        <SearchInput
          clearLabel={clearLabel}
          label={searchLabel}
          onChange={onQueryChange}
          placeholder={searchPlaceholder}
          value={query}
        />
        <IconButton
          aria-haspopup={addHasPopup}
          disabled={addDisabled}
          icon={Plus}
          label={addLabel}
          onClick={onAdd}
        />
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
