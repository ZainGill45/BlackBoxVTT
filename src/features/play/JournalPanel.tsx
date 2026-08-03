import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { SidebarCollectionPanel } from './SidebarCollectionPanel';

export function JournalPanel() {
  const [query, setQuery] = useState('');

  return (
    <SidebarCollectionPanel
      addLabel="Add journal entry"
      clearLabel="Clear journal search"
      emptyIcon={BookOpen}
      emptyIconId="journal"
      onAdd={() => undefined}
      onQueryChange={setQuery}
      query={query}
      searchLabel="Search journal"
      searchPlaceholder="Search journal"
      showEmpty
    />
  );
}
