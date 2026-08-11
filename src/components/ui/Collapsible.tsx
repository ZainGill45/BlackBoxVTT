import {
  useId,
  useState,
  type ReactNode,
} from 'react';
import styles from './Collapsible.module.css';

export function CollapsibleStateIcon({ expanded }: { expanded: boolean }) {
  const paths = expanded
    ? [
        'M2.5 6.5h4v-4',
        'M13.5 6.5h-4v-4',
        'M2.5 9.5h4v4',
        'M13.5 9.5h-4v4',
      ]
    : [
        'M6.5 2.5h-4v4',
        'M9.5 2.5h4v4',
        'M6.5 13.5h-4v-4',
        'M9.5 13.5h4v-4',
      ];

  return (
    <svg
      aria-hidden
      className={styles.stateIcon}
      data-collapsible-icon={expanded ? 'close' : 'open'}
      fill="none"
      height="1rem"
      shapeRendering="crispEdges"
      viewBox="0 0 16 16"
      width="1rem"
    >
      {paths.map((path) => (
        <path
          key={path}
          d={path}
          stroke="currentColor"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

interface CollapsibleProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  label: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
}

export function Collapsible({
  children,
  className,
  contentClassName,
  defaultExpanded = false,
  expanded,
  label,
  onExpandedChange,
}: CollapsibleProps) {
  const generatedId = useId();
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? internalExpanded;
  const triggerId = `${generatedId}-trigger`;
  const contentId = `${generatedId}-content`;

  const toggle = () => {
    const nextExpanded = !isExpanded;
    if (expanded === undefined) {
      setInternalExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };

  return (
    <div
      className={[styles.collapsible, className].filter(Boolean).join(' ')}
    >
      <button
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-controls={contentId}
        aria-expanded={isExpanded}
        onClick={toggle}
      >
        <span>{label}</span>
        <CollapsibleStateIcon expanded={isExpanded} />
      </button>
      <div
        id={contentId}
        role="region"
        className={[styles.content, contentClassName]
          .filter(Boolean)
          .join(' ')}
        aria-labelledby={triggerId}
        hidden={!isExpanded}
      >
        {children}
      </div>
    </div>
  );
}
