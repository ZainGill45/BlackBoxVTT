import type { CampaignSystemState } from './gameSystems';
import type {
  JournalApi,
  SystemJournalEntry,
} from './journal';
import type { NetworkApi } from './network';
import type { Result } from './result';

export const journalWindowIpcChannels = {
  bootstrapCharacter: 'journal-window:bootstrap-character',
  closeCampaign: 'journal-window:close-campaign',
  closeCharacter: 'journal-window:close-character',
  closeRequested: 'journal-window:close-requested',
  focusCharacter: 'journal-window:focus-character',
  openCharacter: 'journal-window:open-character',
  ready: 'journal-window:ready',
  setTitle: 'journal-window:set-title',
} as const;

export interface JournalWindowGeometry {
  contentHeight: number;
  contentWidth: number;
  rootFontSize: number;
}

export interface JournalWindowEntryInput {
  campaignId: string;
  entryId: string;
}

export interface OpenJournalWindowInput extends JournalWindowEntryInput {
  geometry: JournalWindowGeometry;
}

export interface CloseJournalWindowsInput {
  campaignId: string;
}

export interface JournalWindowError {
  code:
    | 'invalid_input'
    | 'not_found'
    | 'permission_denied'
    | 'unavailable';
  message: string;
}

export type JournalWindowResult<T> = Result<T, JournalWindowError>;

export interface DetachedCharacterContext {
  campaignId: string;
  entry: SystemJournalEntry;
  geometry: JournalWindowGeometry;
  system: CampaignSystemState;
}

export type CharacterSheetJournalApi = Pick<
  JournalApi,
  'getEntry' | 'list' | 'onChanged' | 'renameEntry' | 'updateEntryData'
>;

export type CharacterSheetNetworkApi = Pick<
  NetworkApi,
  'sendChatMessage' | 'sendChatRoll'
>;

export interface JournalWindowApi {
  closeCampaign(input: CloseJournalWindowsInput): Promise<void>;
  focusCharacter(
    input: JournalWindowEntryInput,
  ): Promise<JournalWindowResult<boolean>>;
  openCharacter(
    input: OpenJournalWindowInput,
  ): Promise<JournalWindowResult<'focused' | 'opened'>>;
}

export interface DetachedCharacterHostApi {
  bootstrap(): Promise<JournalWindowResult<DetachedCharacterContext>>;
  close(): void;
  onCloseRequested(listener: () => void): () => void;
  ready(): void;
  setTitle(title: string): void;
}

export interface DetachedCharacterApi {
  host: DetachedCharacterHostApi;
  journal: CharacterSheetJournalApi;
  network: CharacterSheetNetworkApi;
}
