import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DetachedCharacterContext } from './shared/journalWindows';
import {
  DetachedSystemJournalEntry,
  hasDetachedSystemJournalEntryRenderer,
} from './systems/rendererRegistry';
import './styles/tokens.css';
import './styles/global.css';
import './styles/sceneTextFonts.css';

const rootElement = document.querySelector<HTMLDivElement>('#root');
const api = window.blackBoxDetachedCharacter;

function DetachedCharacterApp({
  context,
}: {
  context: DetachedCharacterContext;
}) {
  const [entry, setEntry] = useState(context.entry);
  const [closeRequestId, setCloseRequestId] = useState(0);

  useEffect(
    () => api.host.onCloseRequested(() =>
      setCloseRequestId((current) => current + 1),
    ),
    [],
  );

  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      api.host.ready();
      frame = 0;
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <DetachedSystemJournalEntry
      campaignId={context.campaignId}
      closeRequestId={closeRequestId}
      entry={entry}
      journalApi={api.journal}
      networkApi={api.network}
      onDismiss={() => api.host.close()}
      onUpdated={(updated) => {
        setEntry(updated);
        document.title = updated.name;
        api.host.setTitle(updated.name);
      }}
      system={context.system}
    />
  );
}

void api.host.bootstrap().then((result) => {
  if (
    !rootElement ||
    !result.ok ||
    !hasDetachedSystemJournalEntryRenderer(result.value.entry.typeId)
  ) {
    api.host.close();
    return;
  }
  document.documentElement.style.fontSize =
    `${result.value.geometry.rootFontSize}px`;
  document.title = result.value.entry.name;
  api.host.setTitle(result.value.entry.name);
  createRoot(rootElement).render(
    <StrictMode>
      <DetachedCharacterApp context={result.value} />
    </StrictMode>,
  );
});
