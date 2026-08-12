import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import { z } from 'zod';
import {
  journalWindowIpcChannels,
  type JournalWindowResult,
} from '../shared/journalWindows';
import { MAX_JOURNAL_TITLE_INPUT_CODE_UNITS } from '../shared/journal';
import type { JournalWindowManager } from './journalWindowManager';

const entry = z.object({
  campaignId: z.string().uuid(),
  entryId: z.string().uuid(),
}).strict();
const geometry = z.object({
  contentHeight: z.number().finite().min(320).max(16_384),
  contentWidth: z.number().finite().min(320).max(16_384),
  rootFontSize: z.number().finite().min(8).max(64),
}).strict();
const open = entry.extend({ geometry });
const campaign = z.object({ campaignId: z.string().uuid() }).strict();
const title = z.object({
  title: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
}).strict();

function invalid<T>(): JournalWindowResult<T> {
  return {
    error: {
      code: 'invalid_input',
      message: 'The detached Journal window request contains invalid input.',
    },
    ok: false,
  };
}

export function registerJournalWindowIpcHandlers(
  ipc: IpcMain,
  manager: JournalWindowManager,
  isMainSender: (sender: WebContents) => boolean,
) {
  const handledChannels = [
    journalWindowIpcChannels.bootstrapCharacter,
    journalWindowIpcChannels.closeCampaign,
    journalWindowIpcChannels.focusCharacter,
    journalWindowIpcChannels.openCharacter,
  ];
  for (const channel of handledChannels) ipc.removeHandler(channel);

  ipc.handle(
    journalWindowIpcChannels.openCharacter,
    (event: IpcMainInvokeEvent, input: unknown) => {
      if (!isMainSender(event.sender)) return invalid();
      const parsed = open.safeParse(input);
      return parsed.success ? manager.openCharacter(parsed.data) : invalid();
    },
  );
  ipc.handle(
    journalWindowIpcChannels.focusCharacter,
    (event: IpcMainInvokeEvent, input: unknown) => {
      if (!isMainSender(event.sender)) return invalid();
      const parsed = entry.safeParse(input);
      return parsed.success ? manager.focusCharacter(parsed.data) : invalid();
    },
  );
  ipc.handle(
    journalWindowIpcChannels.closeCampaign,
    async (event: IpcMainInvokeEvent, input: unknown) => {
      if (!isMainSender(event.sender)) return;
      const parsed = campaign.safeParse(input);
      if (parsed.success) await manager.closeCampaign(parsed.data.campaignId);
    },
  );
  ipc.handle(
    journalWindowIpcChannels.bootstrapCharacter,
    (event: IpcMainInvokeEvent) => manager.bootstrap(event.sender),
  );

  const handleReady = (event: IpcMainEvent) => manager.markReady(event.sender);
  const handleClose = (event: IpcMainEvent) => manager.confirmClose(event.sender);
  const handleTitle = (event: IpcMainEvent, input: unknown) => {
    const parsed = title.safeParse(input);
    if (parsed.success) manager.setTitle(event.sender, parsed.data.title);
  };
  ipc.on(journalWindowIpcChannels.ready, handleReady);
  ipc.on(journalWindowIpcChannels.closeCharacter, handleClose);
  ipc.on(journalWindowIpcChannels.setTitle, handleTitle);

  return () => {
    for (const channel of handledChannels) ipc.removeHandler(channel);
    ipc.removeListener(journalWindowIpcChannels.ready, handleReady);
    ipc.removeListener(journalWindowIpcChannels.closeCharacter, handleClose);
    ipc.removeListener(journalWindowIpcChannels.setTitle, handleTitle);
  };
}
