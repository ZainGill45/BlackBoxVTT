import {
  journalWindowIpcChannels,
  type JournalWindowApi,
} from '../shared/journalWindows';

type IpcInvoke = (channel: string, input: unknown) => Promise<unknown>;

export function createJournalWindowApi(invoke: IpcInvoke): JournalWindowApi {
  return {
    closeCampaign: (input) =>
      invoke(journalWindowIpcChannels.closeCampaign, input) as Promise<void>,
    focusCharacter: (input) =>
      invoke(
        journalWindowIpcChannels.focusCharacter,
        input,
      ) as ReturnType<JournalWindowApi['focusCharacter']>,
    openCharacter: (input) =>
      invoke(
        journalWindowIpcChannels.openCharacter,
        input,
      ) as ReturnType<JournalWindowApi['openCharacter']>,
  };
}
